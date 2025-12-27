'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';

// ============================================
// TYPES
// ============================================

interface Fact {
  id: string;
  content: string;
  sourceText: string | null;
  category: string;
  subcategory: string | null;
  timeRef: string | null;
  dateStr: string | null;
  entities: string[];
  uploadName: string;
}

interface SubcategoryItem {
  name: string;
  count: number;
}

interface CategoryItem {
  name: string;
  count: number;
  subcategories: SubcategoryItem[];
}

interface TimeRefItem {
  name: string;
  dateStr: string | null;
  count: number;
}

interface TreeData {
  categories: CategoryItem[];
  entities: { name: string; count: number }[];
  timeRefs: TimeRefItem[];
  totalFacts: number;
}

interface Upload {
  id: string;
  name: string;
  rawText: string;
  factCount: number;
  createdAt: string;
}

type FilterType = 'all' | 'category' | 'subcategory' | 'entity' | 'time' | 'upload';
type ViewMode = 'explore' | 'calendar' | 'uploads';
type AppTab = 'info' | 'dump';

interface BreadcrumbItem {
  type: FilterType;
  value: string;
  label: string;
  parent?: string;
}

// ============================================
// CONSTANTS
// ============================================

// Semantic card system - cream cards with colored left borders
// Card backgrounds - warm cream for all cards
const CARD_BG = 'bg-[var(--card-bg)] rounded-lg';

// Category color overlays - desaturated to 80-85% (dusty, unified undertone)
const CATEGORY_OVERLAY: Record<string, string> = {
  social: 'rgba(185, 135, 152, 0.18)', // dusty pink - desaturated, warmer
  professional: 'rgba(105, 135, 148, 0.18)', // dusty blue-green - desaturated
  events: 'rgba(185, 135, 152, 0.18)', // dusty pink
  pledging: 'rgba(105, 135, 148, 0.18)', // dusty blue-green
  meetings: 'rgba(105, 135, 148, 0.18)', // dusty blue-green
  other: 'rgba(185, 135, 152, 0.18)', // dusty pink
};

// Border colors - darker, dustier tones matching each overlay
const CATEGORY_BORDER: Record<string, string> = {
  social: '#d7b7b2', // darker dusty pink border
  professional: '#9fb5b8', // darker dusty blue-green border
  events: '#d7b7b2',
  pledging: '#9fb5b8',
  meetings: '#9fb5b8',
  other: '#d7b7b2',
};

const getCardStyle = (category?: string) => {
  const cat = category?.toLowerCase() || 'other';
  const overlay = CATEGORY_OVERLAY[cat] || CATEGORY_OVERLAY.other;
  const border = CATEGORY_BORDER[cat] || CATEGORY_BORDER.other;
  return {
    background: `linear-gradient(${overlay}, ${overlay}), var(--card-bg)`,
    borderColor: border,
    borderWidth: '1.5px',
    borderStyle: 'solid',
  };
};

// Card class with hover effect
const CARD_CLASS = 'card transition-all';

// Body text color for expanded content (yellow cards use yellow text)
const BODY_COLORS: Record<string, string> = {
  social: 'text-[var(--text-primary)]',
  professional: 'text-[var(--text-primary)]',
  events: 'text-[var(--text-primary)]',
  pledging: 'text-[var(--text-primary)]',
  meetings: 'text-[var(--text-primary)]',
  other: 'text-[var(--text-primary)]',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ============================================
// COMPONENTS
// ============================================

// Semantic text parser - colors times, locations, people
function parseSemanticText(text: string, entities: string[], timeRef?: string): Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> {
  const parts: Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> = [];
  
  if (!text) return [{ text, type: 'text' }];
  
  // Time patterns - match dates, times, and timeRef
  const timePatterns: RegExp[] = [
    /@\w+/gi, // @timeRef
    /\b\w+day\b/gi, // Monday, Wednesday, etc.
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+(?:st|nd|rd|th)?\b/gi, // Full month names
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(?:st|nd|rd|th)?\b/gi, // Short month names
    /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, // 6:30 PM
    /\b(?:from|to)\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, // from 6:30 PM
    /\bevery\s+\w+day\b/gi, // every Wednesday
  ];
  
  // Location patterns - prioritize multi-word locations
  const locationPatterns = [
    /\b(?:Rieber Terrace|9th Floor Lounge|Study Hall)\b/gi, // Multi-word locations
    /\b(?:Kelton|Levering|apartment|lounge|floor|room|building|terrace)\b/gi, // Single-word locations
  ];
  
  // People/entities - sort by length descending to match longest phrases first
  const sortedEntities = [...entities]
    .filter(e => e && e.length > 0)
    .sort((a, b) => b.length - a.length);
  
  const matches: Array<{ index: number; endIndex: number; type: 'time' | 'location' | 'people'; text: string }> = [];
  
  // Find all matches with their positions
  let match;
  
  // Helper to check if range overlaps with existing matches
  const addMatch = (index: number, length: number, type: 'time' | 'location' | 'people', matchedText: string) => {
    const endIndex = index + length;
    
    // Check for overlaps - if this range overlaps with any existing match, skip it
    const overlaps = matches.some(m => 
      (index >= m.index && index < m.endIndex) || 
      (endIndex > m.index && endIndex <= m.endIndex) ||
      (index <= m.index && endIndex >= m.endIndex)
    );
    
    if (!overlaps) {
      matches.push({ index, endIndex, type, text: matchedText });
    }
  };
  
  // Find time matches
  for (const timePattern of timePatterns) {
    timePattern.lastIndex = 0;
    while ((match = timePattern.exec(text)) !== null) {
      addMatch(match.index, match[0].length, 'time', match[0]);
    }
  }
  
  // Find location matches (multi-word first)
  for (const locationPattern of locationPatterns) {
    locationPattern.lastIndex = 0;
    while ((match = locationPattern.exec(text)) !== null) {
      addMatch(match.index, match[0].length, 'location', match[0]);
    }
  }
  
  // Find people/entity matches (longest first to avoid partial matches like "Hall" instead of "Study Hall")
  for (const entity of sortedEntities) {
    const entityPattern = new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    entityPattern.lastIndex = 0;
    while ((match = entityPattern.exec(text)) !== null) {
      addMatch(match.index, match[0].length, 'people', match[0]);
    }
  }
  
  // Sort by index
  matches.sort((a, b) => a.index - b.index);
  
  // Build parts array without overlaps
  let lastIndex = 0;
  for (const m of matches) {
    if (m.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, m.index), type: 'text' });
    }
    parts.push({ text: m.text, type: m.type });
    lastIndex = m.endIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), type: 'text' });
  }
  
  return parts.length > 0 ? parts : [{ text, type: 'text' }];
}

function HighlightedText({ 
  text, 
  entities, 
  onEntityClick,
  onTimeClick,
  highlightClass,
  highlightBgClass,
}: { 
  text: string; 
  entities: string[]; 
  onEntityClick?: (entity: string) => void;
  onTimeClick?: (timeText: string) => void;
  highlightClass?: string;
  highlightBgClass?: string;
}) {
  if (!text) return <span>{text}</span>;
  
  const semanticParts = parseSemanticText(text, entities);
  
  return (
    <>
      {semanticParts.map((part, i) => {
        if (part.type === 'time') {
          return (
            <button
              key={i}
              onClick={() => onTimeClick?.(part.text)}
              className="text-[var(--highlight-red)] font-mono hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-1 transition-colors cursor-pointer"
              title="View in calendar"
            >
              {part.text}
            </button>
          );
        }
        if (part.type === 'location') {
          return (
            <button
              key={i}
              onClick={() => onEntityClick?.(part.text.toLowerCase())}
              className="text-[var(--highlight-blue)] hover:bg-[rgba(59,124,150,0.16)] hover:rounded px-1 transition-colors cursor-pointer font-mono"
              title="Filter by location"
            >
              {part.text}
            </button>
          );
        }
        if (part.type === 'people') {
          return (
            <button
              key={i}
              onClick={() => onEntityClick?.(part.text.toLowerCase())}
              className="text-[var(--highlight-blue)] hover:bg-[rgba(59,124,150,0.16)] hover:rounded px-1 cursor-pointer font-mono transition-colors"
              title="Filter by entity"
            >
              {part.text}
            </button>
          );
        }
        return <Fragment key={i}>{part.text}</Fragment>;
      })}
    </>
  );
}

// Icons
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  );
}

function HelpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ============================================
// DUMP TAB CONTENT (Text Explorer)
// ============================================

function DumpTab({ 
  viewMode: parentViewMode, 
  setViewMode: setParentViewMode,
  onFilterChange, 
  onBreadcrumbsChange,
  breadcrumbClickIndex,
  resetBreadcrumbClick,
  calendarDate: parentCalendarDate,
  setCalendarDate: setParentCalendarDate
}: { 
  viewMode?: ViewMode;
  setViewMode?: (mode: ViewMode) => void;
  onFilterChange?: (filter: BreadcrumbItem) => void;
  onBreadcrumbsChange?: (breadcrumbs: BreadcrumbItem[]) => void;
  breadcrumbClickIndex?: number | null;
  resetBreadcrumbClick?: () => void;
  calendarDate?: { year: number; month: number };
  setCalendarDate?: (date: { year: number; month: number } | ((prev: { year: number; month: number }) => { year: number; month: number })) => void;
}) {
  const [tree, setTree] = useState<TreeData | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [allFacts, setAllFacts] = useState<Fact[]>([]); // For calendar view - all facts
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('explore');
  
  // Use parent viewMode if provided, otherwise use local state
  const activeViewMode = parentViewMode !== undefined ? parentViewMode : viewMode;
  
  // Sync with parent viewMode if provided
  useEffect(() => {
    if (parentViewMode !== undefined) {
      setViewMode(parentViewMode);
    }
  }, [parentViewMode]);
  
  // Helper to update viewMode (use parent setter if provided)
  const updateViewMode = useCallback((mode: ViewMode) => {
    if (setParentViewMode) {
      setParentViewMode(mode);
    } else {
      setViewMode(mode);
    }
  }, [setParentViewMode]);
  
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    recurring: true,
    facts: true,
    past: true,
  });
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  
  // Sync with parent calendarDate if provided
  useEffect(() => {
    if (parentCalendarDate) {
      setCalendarDate(parentCalendarDate);
    }
  }, [parentCalendarDate]);
  
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { type: 'all', value: '', label: 'all' }
  ]);
  
  // Sync breadcrumbs with parent when they click home or navigate from parent
  useEffect(() => {
    if (onBreadcrumbsChange) {
      onBreadcrumbsChange(breadcrumbs);
    }
  }, []); // Only on mount to initialize parent
  
  // Handle breadcrumb clicks from parent (when user clicks breadcrumb in header)
  useEffect(() => {
    if (breadcrumbClickIndex !== null && breadcrumbClickIndex !== undefined) {
      const newBreadcrumbs = breadcrumbs.slice(0, breadcrumbClickIndex + 1);
      setBreadcrumbs(newBreadcrumbs);
      
      const targetCrumb = newBreadcrumbs[newBreadcrumbs.length - 1];
      
      // Apply the filter based on breadcrumb type
      if (targetCrumb.type === 'all') {
        setFacts(allFacts);
        setExpandedCards({});
      } else if (targetCrumb.type === 'category') {
        setFacts(allFacts.filter(f => f.category === targetCrumb.value));
      } else if (targetCrumb.type === 'subcategory') {
        setFacts(allFacts.filter(f => f.subcategory === targetCrumb.value));
      } else if (targetCrumb.type === 'entity') {
        setFacts(allFacts.filter(f => f.entities.some(e => e.toLowerCase() === targetCrumb.value.toLowerCase())));
      } else if (targetCrumb.type === 'time') {
        setFacts(allFacts.filter(f => f.timeRef?.toLowerCase() === targetCrumb.value.toLowerCase()));
      }
      
      // Reset the click index after processing
      if (resetBreadcrumbClick) {
        resetBreadcrumbClick();
      }
    }
  }, [breadcrumbClickIndex, allFacts, resetBreadcrumbClick]);
  
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    categories: false,
    timeline: false,
    entities: false,
    uploads: false,
  });

  const currentFilter = breadcrumbs[breadcrumbs.length - 1];

  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch('/api/text-explorer/tree');
      const data = await res.json();
      if (data && !data.error) {
        setTree(data);
      }
    } catch (error) {
      console.error('Failed to fetch tree:', error);
    }
  }, []);

  const fetchFacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (currentFilter.type === 'category') {
        params.set('category', currentFilter.value);
      } else if (currentFilter.type === 'subcategory') {
        params.set('subcategory', currentFilter.value);
        if (currentFilter.parent) params.set('category', currentFilter.parent);
      } else if (currentFilter.type === 'entity') {
        params.set('entity', currentFilter.value);
      } else if (currentFilter.type === 'time') {
        params.set('timeRef', currentFilter.value);
      }

      const res = await fetch(`/api/text-explorer/facts?${params}`);
      const data = await res.json();
      setFacts(data.facts ?? []);
    } catch (error) {
      console.error('Failed to fetch facts:', error);
    } finally {
      setLoading(false);
    }
  }, [currentFilter]);

  const fetchUploads = useCallback(async () => {
    try {
      const res = await fetch('/api/text-explorer/uploads');
      const data = await res.json();
      if (data && !data.error) {
        setUploads(data.uploads ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch uploads:', error);
    }
  }, []);

  const fetchAllFacts = useCallback(async () => {
    try {
      console.log('[Calendar] Fetching all facts...');
      const res = await fetch('/api/text-explorer/facts');
      const data = await res.json();
      const facts = data.facts ?? [];
      console.log('[Calendar] Fetched facts count:', facts.length);
      console.log('[Calendar] Sample facts with dates:', facts.slice(0, 3).map((f: Fact) => ({
        id: f.id,
        content: f.content?.substring(0, 50),
        dateStr: f.dateStr,
        timeRef: f.timeRef,
        subcategory: f.subcategory
      })));
      setAllFacts(facts);
    } catch (error) {
      console.error('Failed to fetch all facts:', error);
    }
  }, []);

  const deleteUpload = async (id: string) => {
    setDeletingUpload(id);
    try {
      const res = await fetch(`/api/text-explorer/uploads?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUploads();
        fetchTree();
        fetchFacts();
        fetchAllFacts();
      }
    } catch (error) {
      console.error('Failed to delete upload:', error);
    } finally {
      setDeletingUpload(null);
    }
  };

  useEffect(() => { fetchTree(); }, [fetchTree]);
  useEffect(() => { fetchFacts(); }, [fetchFacts]);
  useEffect(() => { fetchUploads(); }, [fetchUploads]);
  useEffect(() => { fetchAllFacts(); }, [fetchAllFacts]);

  const handleUpload = async () => {
    if (!uploadText.trim()) return;
    setUploading(true);
    try {
      console.log('[Upload] Starting upload...');
      const res = await fetch('/api/text-explorer/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: uploadText }),
      });
      if (res.ok) {
        console.log('[Upload] Upload successful, refreshing data...');
        setUploadText('');
        setShowUpload(false);
        // Wait a bit for database transaction to commit
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('[Upload] Fetching tree...');
        await fetchTree();
        console.log('[Upload] Fetching all facts...');
        await fetchAllFacts();
        console.log('[Upload] Fetching filtered facts...');
        await fetchFacts();
        console.log('[Upload] Fetching uploads...');
        await fetchUploads();
        console.log('[Upload] All fetches complete. Current allFacts count:', allFacts.length);
        // Force a small delay to ensure state updates propagate
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('[Upload] Upload process complete');
      } else {
        console.error('[Upload] Upload failed with status:', res.status);
      }
    } catch (error) {
      console.error('[Upload] Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const navigateTo = (type: FilterType, value: string, label: string, parent?: string) => {
    // Switch to explore view when navigating to a filter
    updateViewMode('explore');
    
    let newBreadcrumbs: BreadcrumbItem[];
    
    if (type === 'all') {
      newBreadcrumbs = [{ type: 'all', value: '', label: 'all' }];
      setExpandedCards({});
    } else if (type === 'subcategory' && parent) {
      newBreadcrumbs = [
        { type: 'all', value: '', label: 'all' },
        { type: 'category', value: parent, label: parent },
        { type, value, label, parent }
      ];
    } else {
      newBreadcrumbs = [
        { type: 'all', value: '', label: 'all' },
        { type, value, label }
      ];
    }
    
    setBreadcrumbs(newBreadcrumbs);
    
    // Notify parent of filter change
    if (onFilterChange) {
      onFilterChange(newBreadcrumbs[newBreadcrumbs.length - 1]);
    }
    
    // Notify parent of breadcrumbs change
    if (onBreadcrumbsChange) {
      onBreadcrumbsChange(newBreadcrumbs);
    }
  };

  // Auto-expand cards that match the current filter
  useEffect(() => {
    if (currentFilter.type !== 'all' && facts.length > 0) {
      const cardsToExpand: Record<string, boolean> = {};
      facts.forEach(fact => {
        if (fact.subcategory) {
          const key = fact.subcategory.toLowerCase();
          cardsToExpand[key] = true;
        }
      });
      setExpandedCards(cardsToExpand);
    }
  }, [facts, currentFilter]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const toggleCard = (id: string) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCategoryCollapse = (category: 'recurring' | 'facts' | 'past') => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  // Group facts by subcategory
  // Helper function to calculate days until/since event and map to urgency bucket
  const getUrgencyBucket = (dateStr: string | null, isPast: boolean): 'critical' | 'high' | 'medium' | 'low' | 'minimal' => {
    if (!dateStr || dateStr.startsWith('recurring:')) return 'minimal';
    
    try {
      const parts = dateStr.split('-');
      if (parts.length !== 3) return 'minimal';
      
      const eventDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      
      const diffTime = eventDate.getTime() - today.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (isPast) {
        // For past events: invert the mapping (yesterday = more saturated, older = more neutral)
        // diffDays will be negative for past events, so we use -diffDays to get days since
        const daysSince = -diffDays;
        if (daysSince === 1) return 'high'; // Yesterday
        if (daysSince <= 3) return 'medium';
        if (daysSince <= 7) return 'low';
        return 'minimal';
      } else {
        // For future events: normal urgency mapping
        if (diffDays === 0) return 'critical';
        if (diffDays >= 1 && diffDays <= 3) return 'high';
        if (diffDays >= 4 && diffDays <= 7) return 'medium';
        if (diffDays >= 8 && diffDays <= 14) return 'low';
        return 'minimal';
      }
    } catch (e) {
      return 'minimal';
    }
  };

  // Helper function to get date chip Tailwind classes based on urgency
  const getDateChipClasses = (urgency: 'critical' | 'high' | 'medium' | 'low' | 'minimal'): string => {
    const baseClasses = 'text-[10px] px-1.5 py-0.5 rounded border font-mono';
    
    switch (urgency) {
      case 'critical':
        // Stronger red background, red border, darker red text
        return `${baseClasses} text-[#ce6087] border-[#ce6087] bg-[rgba(206,96,135,0.25)]`;
      case 'high':
        // Lighter red/pink background, soft red border, normal text
        return `${baseClasses} text-[var(--text-meta)] border-[rgba(206,96,135,0.4)] bg-[rgba(206,96,135,0.12)]`;
      case 'medium':
        // Very light pink background, subtle border
        return `${baseClasses} text-[var(--text-meta)] border-[rgba(206,96,135,0.25)] bg-[rgba(206,96,135,0.08)]`;
      case 'low':
        // Almost neutral background, hairline border
        return `${baseClasses} text-[var(--text-meta)] border-[var(--text-meta)]/15 bg-[var(--text-meta)]/5`;
      case 'minimal':
      default:
        // Neutral background, very faint border
        return `${baseClasses} text-[var(--text-meta)] border-[var(--text-meta)]/20 bg-[var(--text-meta)]/3`;
    }
  };

  // Helper function to get card style based on column (left = red, right = blue-green)
  const getColumnCardStyle = (columnType: 'left' | 'right') => {
    if (columnType === 'left') {
      // Red overlay for left column (Today + Upcoming)
      return {
        background: `linear-gradient(rgba(185, 135, 152, 0.18), rgba(185, 135, 152, 0.18)), var(--card-bg)`,
        borderColor: '#d7b7b2',
        borderWidth: '1.5px',
        borderStyle: 'solid',
      };
    } else {
      // Blue-green overlay for right column (Recurring + Facts + Past)
      return {
        background: `linear-gradient(rgba(105, 135, 148, 0.18), rgba(105, 135, 148, 0.18)), var(--card-bg)`,
        borderColor: '#9fb5b8',
        borderWidth: '1.5px',
        borderStyle: 'solid',
      };
    }
  };

  // Helper function to render a fact card
  const renderFactCard = (fact: Fact, groupFacts: Fact[], columnType: 'left' | 'right', isPastEvent: boolean = false) => {
    if (!fact.subcategory) return null;
    
    const subcategory = fact.subcategory.toLowerCase();
    const isExpanded = expandedCards[subcategory];
    const mainFact = groupFacts[0];
    
    // Show only ONE canonical date chip - the primary date (fix UTC offset issue)
    let dateChip = null;
    let urgency: 'critical' | 'high' | 'medium' | 'low' | 'minimal' = 'minimal';
    
    if (mainFact.dateStr && !mainFact.dateStr.startsWith('recurring:')) {
      try {
        // Parse as UTC to avoid timezone offset issues
        const parts = mainFact.dateStr.split('-');
        if (parts.length === 3) {
          const year = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1; // 0-indexed
          const day = parseInt(parts[2]);
          dateChip = `${MONTHS[month]} ${day}`;
          
          // Calculate urgency based on time-to-event
          urgency = getUrgencyBucket(mainFact.dateStr, isPastEvent);
        }
      } catch (e) {}
    } else if (mainFact.dateStr && mainFact.dateStr.startsWith('recurring:')) {
      // For recurring events, show the day of week
      const day = mainFact.dateStr.replace('recurring:', '');
      dateChip = day.charAt(0).toUpperCase() + day.slice(1, 3);
      urgency = 'minimal'; // Recurring events always use minimal styling
    }
    
    // Get date chip classes based on urgency
    const dateChipClasses = getDateChipClasses(urgency);
    
    return (
      <div key={fact.id} className="animate-slide-in">
        <div 
          className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] hover:border-[var(--highlight-red)]/40 transition-colors`}
          style={getColumnCardStyle(columnType)}
        >
          {/* Two-Column Header */}
          <button
            onClick={() => toggleCard(fact.subcategory!.toLowerCase())}
            className="w-full p-4 text-left transition-colors"
          >
            {/* Header Row: Title and date on same baseline */}
            <div className="flex items-baseline justify-between gap-4 mb-2">
              {/* Left: Title */}
              <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight flex-1">
                {fact.subcategory}
              </h3>
              
              {/* Right: Single pale date chip + expand arrow */}
              <div className="flex items-baseline gap-2">
                {dateChip && (
                  <span className={dateChipClasses}>
                    {dateChip}
                  </span>
                )}
                <span className="text-[var(--text-meta)] text-sm">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>
            </div>
            
            {/* True summary: the actual event description */}
            <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
              {mainFact.content}
            </p>
          </button>
          
          {/* Expanded body content - Wikipedia style */}
          {isExpanded && (
            <div className="border-t border-[var(--card-border)] p-4 space-y-4 animate-slide-in">
              {groupFacts.map((f) => (
                <div key={f.id} className="text-sm">
                  {f.sourceText && (
                    <p className="text-[var(--text-on-card)] leading-relaxed mb-3 font-light">
                      <HighlightedText 
                        text={f.sourceText} 
                        entities={f.entities}
                        onEntityClick={(e) => {
                          navigateTo('entity', e.toLowerCase(), e);
                          if (f.subcategory) {
                            const key = f.subcategory.toLowerCase();
                            setExpandedCards(prev => ({ ...prev, [key]: true }));
                          }
                        }}
                        onTimeClick={(timeText) => {
                          if (f.dateStr && !f.dateStr.startsWith('recurring:')) {
                            try {
                              const date = new Date(f.dateStr);
                              if (!isNaN(date.getTime())) {
                                const newDate = { year: date.getFullYear(), month: date.getMonth() };
                                if (setParentCalendarDate) {
                                  setParentCalendarDate(newDate);
                                } else {
                                  setCalendarDate(newDate);
                                }
                              }
                            } catch (e) {
                              console.log('Could not parse date:', f.dateStr);
                            }
                          }
                          if (setParentViewMode) {
                            setParentViewMode('calendar');
                          }
                          updateViewMode('calendar');
                        }}
                      />
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {f.entities.slice(0, 8).map((entity) => (
                      <button
                        key={entity}
                        onClick={() => {
                          navigateTo('entity', entity.toLowerCase(), entity);
                          if (f.subcategory) {
                            const key = f.subcategory.toLowerCase();
                            setExpandedCards(prev => ({ ...prev, [key]: true }));
                          }
                        }}
                        className="text-xs font-mono text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-1 transition-colors"
                      >
                        {entity}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const groupedFacts = useMemo(() => {
    const groups: Record<string, Fact[]> = {};
    const ungrouped: Fact[] = [];
    
    // Categorize facts by time relevance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    const todayFacts: Fact[] = [];
    const upcomingFacts: Fact[] = [];
    const recurringFacts: Fact[] = [];
    const staticFacts: Fact[] = []; // Facts without dates
    const oldFacts: Fact[] = [];
    
    for (const fact of facts) {
      // Group by subcategory for card rendering
      if (fact.subcategory) {
        const key = fact.subcategory.toLowerCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(fact);
      } else {
        ungrouped.push(fact);
      }
      
      // Categorize by time (use first fact of each subcategory to avoid duplicates)
      if (fact.subcategory) {
        const key = fact.subcategory.toLowerCase();
        const isFirstInGroup = groups[key][0] === fact;
        
        if (isFirstInGroup) {
          if (fact.dateStr) {
            if (fact.dateStr.startsWith('recurring:')) {
              recurringFacts.push(fact);
            } else if (fact.dateStr === todayStr) {
              todayFacts.push(fact);
            } else if (fact.dateStr > todayStr) {
              upcomingFacts.push(fact);
            } else {
              oldFacts.push(fact);
            }
          } else {
            staticFacts.push(fact);
          }
        }
      } else {
        // Ungrouped facts
        if (fact.dateStr) {
          if (fact.dateStr.startsWith('recurring:')) {
            recurringFacts.push(fact);
          } else if (fact.dateStr === todayStr) {
            todayFacts.push(fact);
          } else if (fact.dateStr > todayStr) {
            upcomingFacts.push(fact);
          } else {
            oldFacts.push(fact);
          }
        } else {
          staticFacts.push(fact);
        }
      }
    }
    
    // Sort upcoming by date (nearest first)
    upcomingFacts.sort((a, b) => {
      if (!a.dateStr || !b.dateStr) return 0;
      return a.dateStr.localeCompare(b.dateStr);
    });
    
    // Sort old events by date (most recent first - yesterday first)
    oldFacts.sort((a, b) => {
      if (!a.dateStr || !b.dateStr) return 0;
      return b.dateStr.localeCompare(a.dateStr);
    });
    
    // Sort recurring by weekday
    const weekdayOrder: Record<string, number> = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
      'friday': 5, 'saturday': 6, 'sunday': 7
    };
    recurringFacts.sort((a, b) => {
      const aDay = (a.dateStr || '').toLowerCase();
      const bDay = (b.dateStr || '').toLowerCase();
      let aOrder = 8, bOrder = 8;
      for (const [day, order] of Object.entries(weekdayOrder)) {
        if (aDay.includes(day)) aOrder = order;
        if (bDay.includes(day)) bOrder = order;
      }
      return aOrder - bOrder;
    });
    
    return { 
      groups, 
      ungrouped,
      todayFacts,
      upcomingFacts,
      recurringFacts,
      staticFacts,
      oldFacts
    };
  }, [facts]);

  // Calendar helpers
  const calendarDays = useMemo(() => {
    const { year, month } = calendarDate;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    
    const days: (number | null)[] = [];
    for (let i = 0; i < startingDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [calendarDate]);

  // Helper to parse date from timeRef (e.g., "November 8th", "november 6th", "@November 8th")
  const parseDateFromTimeRef = (timeRef: string | null, year: number): string | null => {
    if (!timeRef) return null;
    
    const lower = timeRef.toLowerCase().replace(/^@\s*/, ''); // Remove leading @
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                       'july', 'august', 'september', 'october', 'november', 'december'];
    const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                         'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();
    
    // Try full month names first
    for (let i = 0; i < monthNames.length; i++) {
      if (lower.includes(monthNames[i])) {
        // Extract day number (handle "8th", "8", etc.)
        const dayMatch = lower.match(/(\d+)(?:st|nd|rd|th)?/);
        if (dayMatch) {
          const day = parseInt(dayMatch[1], 10);
          if (day >= 1 && day <= 31) {
            const month = i + 1;
            let dateYear = year;
            
            // If no explicit year in timeRef, check if date is in the past
            if (!timeRef.match(/\b(20\d{2})\b/)) {
              const parsedDate = new Date(year, month - 1, day);
              const todayStart = new Date(currentYear, currentMonth - 1, currentDay);
              todayStart.setHours(0, 0, 0, 0);
              
              // If parsed date is in the past, use next year
              if (parsedDate < todayStart) {
                dateYear = currentYear + 1;
              } else {
                dateYear = currentYear;
              }
            }
            
            return `${dateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        }
      }
    }
    
    // Try abbreviated month names
    for (let i = 0; i < monthAbbrevs.length; i++) {
      if (lower.includes(monthAbbrevs[i])) {
        const dayMatch = lower.match(/(\d+)(?:st|nd|rd|th)?/);
        if (dayMatch) {
          const day = parseInt(dayMatch[1], 10);
          if (day >= 1 && day <= 31) {
            const month = i + 1;
            let dateYear = year;
            
            // If no explicit year in timeRef, check if date is in the past
            if (!timeRef.match(/\b(20\d{2})\b/)) {
              const parsedDate = new Date(year, month - 1, day);
              const todayStart = new Date(currentYear, currentMonth - 1, currentDay);
              todayStart.setHours(0, 0, 0, 0);
              
              // If parsed date is in the past, use next year
              if (parsedDate < todayStart) {
                dateYear = currentYear + 1;
              } else {
                dateYear = currentYear;
              }
            }
            
            return `${dateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        }
      }
    }
    
    return null;
  };

  // Calendar uses ALL facts, not just filtered ones
  const factsByDate = useMemo(() => {
    console.log('[Calendar] Computing factsByDate from', allFacts.length, 'facts');
    const map: Record<string, Fact[]> = {};
    const { year } = calendarDate;
    let factsWithDates = 0;
    let factsWithoutDates = 0;
    
    for (const fact of allFacts) {
      let dateStr: string | null = null;
      
      // First try dateStr (if it's a valid date string)
      if (fact.dateStr && !fact.dateStr.startsWith('recurring:')) {
        try {
          const parsed = fact.dateStr.split('T')[0];
          // Validate it's a proper date format (YYYY-MM-DD)
          if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
            const parsedDate = new Date(parsed);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // If the date is in the past, increment the year
            if (parsedDate < today) {
              const [year, month, day] = parsed.split('-');
              const nextYear = parseInt(year, 10) + 1;
              dateStr = `${nextYear}-${month}-${day}`;
              console.log('[Calendar] Date in past, adjusted:', parsed, '->', dateStr);
            } else {
              dateStr = parsed;
            }
          }
        } catch (e) {
          // Invalid dateStr, try timeRef
        }
      } 
      
      // Fallback to parsing timeRef if dateStr wasn't valid
      if (!dateStr && fact.timeRef) {
        // Try to extract year from timeRef first, otherwise use current year
        const timeRefYear = fact.timeRef.match(/\b(20\d{2})\b/);
        const today = new Date();
        const currentYear = today.getFullYear();
        const yearToUse = timeRefYear ? parseInt(timeRefYear[1], 10) : currentYear;
        dateStr = parseDateFromTimeRef(fact.timeRef, yearToUse);
        if (dateStr) {
          console.log('[Calendar] Parsed timeRef:', fact.timeRef, '->', dateStr);
        }
      }
      
      if (dateStr) {
        if (!map[dateStr]) map[dateStr] = [];
        map[dateStr].push(fact);
        factsWithDates++;
      } else {
        factsWithoutDates++;
        if (factsWithoutDates <= 3) {
          console.log('[Calendar] Fact without date:', {
            id: fact.id,
            content: fact.content?.substring(0, 50),
            dateStr: fact.dateStr,
            timeRef: fact.timeRef
          });
        }
      }
    }
    console.log('[Calendar] Facts with dates:', factsWithDates, 'without dates:', factsWithoutDates);
    console.log('[Calendar] Date keys:', Object.keys(map).slice(0, 10));
    return map;
  }, [allFacts, calendarDate]);


  const recurringFacts = useMemo(() => allFacts.filter(f => f.dateStr?.startsWith('recurring:')), [allFacts]);

  const getFactsForDay = (day: number) => {
    const { year, month } = calendarDate;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayFacts = factsByDate[dateStr] || [];
    const dayOfWeek = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const recurring = recurringFacts.filter(f => f.dateStr === `recurring:${dayOfWeek}`);
    const result = [...dayFacts, ...recurring];
    if (result.length > 0 && day === new Date().getDate()) {
      console.log('[Calendar] Facts for today (', dateStr, '):', result.length, result.map(f => f.subcategory || f.content.substring(0, 30)));
    }
    return result;
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] flex animate-fade-in">
      {/* Main Content - Full Width */}
      <main className="flex-1 flex flex-col overflow-hidden max-w-6xl mx-auto w-full">
        <div className="flex-1 overflow-auto py-6 px-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <span className="text-[var(--text-meta)] animate-pulse">loading...</span>
            </div>
          ) : activeViewMode === 'explore' ? (
            facts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-[var(--text-meta)]">no facts yet</p>
                <button onClick={() => setShowUpload(true)} className="mt-4 text-sm text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-2 transition-colors">dump some text</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* LEFT COLUMN: THE LIVING TIMELINE */}
                <div className="space-y-6">
                  {/* Today Section */}
                  {groupedFacts.todayFacts.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] mb-3 font-mono">Today</h4>
                      <div className="space-y-3">
                        {groupedFacts.todayFacts.map(fact => {
                          const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                          return renderFactCard(fact, groupFacts, 'left', false);
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Upcoming Section */}
                  {groupedFacts.upcomingFacts.length > 0 && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] mb-3 font-mono">Upcoming</h4>
                      <div className="space-y-3">
                        {groupedFacts.upcomingFacts.map(fact => {
                          const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                          return renderFactCard(fact, groupFacts, 'left', false);
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Show message if left column is empty */}
                  {groupedFacts.todayFacts.length === 0 && groupedFacts.upcomingFacts.length === 0 && (
                    <div className="text-center py-12 text-[var(--text-meta)] opacity-60">
                      <p className="text-sm font-light">No upcoming events</p>
                    </div>
                  )}
                </div>
                
                {/* RIGHT COLUMN: STRUCTURE & HISTORY */}
                <div className="space-y-6">
                  {/* Recurring Section */}
                  {groupedFacts.recurringFacts.length > 0 && (
                    <div>
                      {/* Category Header with Arrow */}
                      <button
                        onClick={() => toggleCategoryCollapse('recurring')}
                        className="w-full flex items-center gap-2 mb-3 group"
                      >
                        <span className="text-[var(--text-meta)] text-sm group-hover:text-[var(--text-on-dark)] transition-colors">
                          {collapsedCategories.recurring ? '▸' : '▾'}
                        </span>
                        <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono group-hover:text-[var(--text-on-dark)] transition-colors">
                          ↻ Recurring
                        </h4>
                      </button>
                      
                      {/* Cards Stack or Expanded */}
                      {collapsedCategories.recurring ? (
                        <div
                          className="relative cursor-pointer"
                          onClick={() => toggleCategoryCollapse('recurring')}
                        >
                          {/* Always show 3 cards for stacks when there are 2+ items */}
                          {groupedFacts.recurringFacts.length >= 2 ? (
                            [0, 1, 2].map((index) => {
                              const factIndex = Math.min(index, groupedFacts.recurringFacts.length - 1);
                              const fact = groupedFacts.recurringFacts[factIndex];
                              const groupFacts = fact ? groupedFacts.groups[fact.subcategory!.toLowerCase()] : null;
                              const mainFact = groupFacts?.[0];
                              const offset = index * 8; // Increased from 4 to 8 for more obvious gaps
                              return (
                                <div
                                  key={`stack-${index}`}
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] transition-all`}
                                  style={{
                                    ...getColumnCardStyle('right'),
                                    position: index === 0 ? 'relative' : 'absolute',
                                    top: index === 0 ? 0 : `${offset}px`,
                                    left: 0,
                                    right: 0,
                                    zIndex: 10 - index,
                                    opacity: index === 2 ? 0.5 : index === 1 ? 0.75 : 1,
                                  }}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact?.subcategory || 'Event'}
                                    </h3>
                                    {index === 0 && mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            // Single card - no stack
                            groupedFacts.recurringFacts[0] && (() => {
                              const fact = groupedFacts.recurringFacts[0];
                              const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                              const mainFact = groupFacts?.[0];
                              return (
                                <div
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                                  style={getColumnCardStyle('right')}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact.subcategory}
                                    </h3>
                                    {mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })()
                          )}
                          {/* Spacer for stacked cards */}
                          {groupedFacts.recurringFacts.length >= 2 && <div style={{ height: '16px' }} />}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupedFacts.recurringFacts.map(fact => {
                            const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                            return renderFactCard(fact, groupFacts, 'right', false);
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Facts Section */}
                  {groupedFacts.staticFacts.length > 0 && (
                    <div>
                      {/* Category Header with Arrow */}
                      <button
                        onClick={() => toggleCategoryCollapse('facts')}
                        className="w-full flex items-center gap-2 mb-3 group"
                      >
                        <span className="text-[var(--text-meta)] text-sm group-hover:text-[var(--text-on-dark)] transition-colors">
                          {collapsedCategories.facts ? '▸' : '▾'}
                        </span>
                        <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono group-hover:text-[var(--text-on-dark)] transition-colors">
                          Facts
                        </h4>
                      </button>
                      
                      {/* Cards Stack or Expanded */}
                      {collapsedCategories.facts ? (
                        <div
                          className="relative cursor-pointer"
                          onClick={() => toggleCategoryCollapse('facts')}
                        >
                          {/* Always show 3 cards for stacks when there are 2+ items */}
                          {groupedFacts.staticFacts.length >= 2 ? (
                            [0, 1, 2].map((index) => {
                              const factIndex = Math.min(index, groupedFacts.staticFacts.length - 1);
                              const fact = groupedFacts.staticFacts[factIndex];
                              const groupFacts = fact ? groupedFacts.groups[fact.subcategory!.toLowerCase()] : null;
                              const mainFact = groupFacts?.[0];
                              const offset = index * 8; // Increased from 4 to 8 for more obvious gaps
                              return (
                                <div
                                  key={`stack-${index}`}
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] transition-all`}
                                  style={{
                                    ...getColumnCardStyle('right'),
                                    position: index === 0 ? 'relative' : 'absolute',
                                    top: index === 0 ? 0 : `${offset}px`,
                                    left: 0,
                                    right: 0,
                                    zIndex: 10 - index,
                                    opacity: index === 2 ? 0.5 : index === 1 ? 0.75 : 1,
                                  }}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact?.subcategory || 'Fact'}
                                    </h3>
                                    {index === 0 && mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            // Single card - no stack
                            groupedFacts.staticFacts[0] && (() => {
                              const fact = groupedFacts.staticFacts[0];
                              const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                              const mainFact = groupFacts?.[0];
                              return (
                                <div
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                                  style={getColumnCardStyle('right')}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact.subcategory}
                                    </h3>
                                    {mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })()
                          )}
                          {/* Spacer for stacked cards */}
                          {groupedFacts.staticFacts.length >= 2 && <div style={{ height: '16px' }} />}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupedFacts.staticFacts.map(fact => {
                            const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                            return renderFactCard(fact, groupFacts, 'right', false);
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Old Events Section */}
                  {groupedFacts.oldFacts.length > 0 && (
                    <div>
                      {/* Category Header with Arrow */}
                      <button
                        onClick={() => toggleCategoryCollapse('past')}
                        className="w-full flex items-center gap-2 mb-3 group"
                      >
                        <span className="text-[var(--text-meta)] text-sm group-hover:text-[var(--text-on-dark)] transition-colors">
                          {collapsedCategories.past ? '▸' : '▾'}
                        </span>
                        <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono group-hover:text-[var(--text-on-dark)] transition-colors">
                          Past
                        </h4>
                      </button>
                      
                      {/* Cards Stack or Expanded */}
                      {collapsedCategories.past ? (
                        <div
                          className="relative cursor-pointer"
                          onClick={() => toggleCategoryCollapse('past')}
                        >
                          {/* Always show 3 cards for stacks when there are 2+ items */}
                          {groupedFacts.oldFacts.length >= 2 ? (
                            [0, 1, 2].map((index) => {
                              const factIndex = Math.min(index, groupedFacts.oldFacts.length - 1);
                              const fact = groupedFacts.oldFacts[factIndex];
                              const groupFacts = fact ? groupedFacts.groups[fact.subcategory!.toLowerCase()] : null;
                              const mainFact = groupFacts?.[0];
                              const offset = index * 8; // Increased from 4 to 8 for more obvious gaps
                              return (
                                <div
                                  key={`stack-${index}`}
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] transition-all`}
                                  style={{
                                    ...getColumnCardStyle('right'),
                                    position: index === 0 ? 'relative' : 'absolute',
                                    top: index === 0 ? 0 : `${offset}px`,
                                    left: 0,
                                    right: 0,
                                    zIndex: 10 - index,
                                    opacity: index === 2 ? 0.5 : index === 1 ? 0.75 : 1,
                                  }}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact?.subcategory || 'Event'}
                                    </h3>
                                    {index === 0 && mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            // Single card - no stack
                            groupedFacts.oldFacts[0] && (() => {
                              const fact = groupedFacts.oldFacts[0];
                              const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                              const mainFact = groupFacts?.[0];
                              return (
                                <div
                                  className={`w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                                  style={getColumnCardStyle('right')}
                                >
                                  <div className="p-4">
                                    <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight mb-2">
                                      {fact.subcategory}
                                    </h3>
                                    {mainFact?.content && (
                                      <p className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed">
                                        {mainFact.content}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })()
                          )}
                          {/* Spacer for stacked cards */}
                          {groupedFacts.oldFacts.length >= 2 && <div style={{ height: '16px' }} />}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupedFacts.oldFacts.map(fact => {
                            const groupFacts = groupedFacts.groups[fact.subcategory!.toLowerCase()];
                            return renderFactCard(fact, groupFacts, 'right', true);
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          ) : activeViewMode === 'calendar' ? (
            /* Calendar View */
            <div className="animate-fade-in">
              {/* Month Navigation - Right Corner */}
              <div className="mb-6 flex items-center justify-end gap-4">
                <button 
                  onClick={() => {
                    if (setParentCalendarDate) {
                      setParentCalendarDate(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
                    } else {
                      setCalendarDate(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
                    }
                  }}
                  className="text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] px-3 py-1 rounded transition-colors"
                >
                  ← prev
                </button>
                <span className="text-sm text-[var(--text-on-dark)] min-w-[140px] text-center font-mono">
                  {MONTHS[calendarDate.month]} {calendarDate.year}
                </span>
                <button 
                  onClick={() => {
                    if (setParentCalendarDate) {
                      setParentCalendarDate(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
                    } else {
                      setCalendarDate(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
                    }
                  }}
                  className="text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] px-3 py-1 rounded transition-colors"
                >
                  next →
                </button>
              </div>
              
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-xs text-[var(--text-meta)] py-2">{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1" key={`calendar-${allFacts.length}-${calendarDate.year}-${calendarDate.month}`}>
                {calendarDays.map((day, i) => {
                  const dayFacts = day ? getFactsForDay(day) : [];
                  const isToday = day && new Date().getDate() === day && new Date().getMonth() === calendarDate.month && new Date().getFullYear() === calendarDate.year;
                  
                  return (
                    <div key={i} className={`min-h-[100px] p-2 rounded-lg border transition-colors ${day ? 'border-[var(--border-subtle)] hover:border-[var(--border)] bg-[var(--bg-main)]' : 'border-transparent'} ${isToday ? 'ring-1 ring-[var(--highlight-blue)]' : ''}`}>
                      {day && (
                        <>
                          <div className={`text-xs mb-1 ${isToday ? 'text-[var(--highlight-blue)] font-medium' : 'text-[var(--text-meta)]'}`}>{day}</div>
                          <div className="space-y-1">
                            {dayFacts.slice(0, 3).map((fact) => {
                              // Determine organic gradient based on fact content
                              const hasLocation = fact.entities.some(e => 
                                ['Rieber Terrace', 'Kelton', 'Levering', 'apartment', 'lounge', 'floor', 'room', 'building', 'terrace', 'hall'].some(loc => e.includes(loc))
                              );
                              const hasPeople = fact.entities.length > 0 && !hasLocation;
                              const hasTime = fact.timeRef || fact.dateStr;
                              
                              return (
                                <button
                                  key={fact.id}
                                  onClick={() => {
                                    // Switch to explore view first - update parent before navigating
                                    if (setParentViewMode) {
                                      setParentViewMode('explore');
                                    }
                                    updateViewMode('explore');
                                    // Navigate to the fact's category/subcategory
                                    if (fact.subcategory && fact.category) {
                                      navigateTo('subcategory', fact.subcategory, fact.subcategory, fact.category);
                                    } else if (fact.category) {
                                      navigateTo('category', fact.category, fact.category);
                                    }
                                  }}
                                  className={`text-[10px] px-1.5 py-0.5 rounded-lg bg-[var(--card-bg)] border card truncate shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] hover:scale-105 transition-transform cursor-pointer text-left w-full`}
                                  style={getCardStyle(fact.category)}
                                  title={`${fact.content} - Click to view`}
                                >
                                  <span className="text-[var(--text-on-card)]">
                                    {fact.subcategory || fact.content.slice(0, 20)}
                                  </span>
                                  {fact.timeRef && (
                                    <span
                                      className="text-[var(--highlight-red)] ml-1 font-mono"
                                      title="View in calendar"
                                    >
                                      @{fact.timeRef.slice(0, 8)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                            {dayFacts.length > 3 && <div className="text-[10px] text-[var(--text-meta)]">+{dayFacts.length - 3}</div>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {recurringFacts.length > 0 && (
                <div 
                  className="mt-6 p-4 rounded-lg border bg-[var(--card-bg)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] card"
                  style={getCardStyle('other')}
                >
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-meta)] mb-3">↻ recurring</h3>
                  <div className="flex flex-wrap gap-2">
                    {recurringFacts.map(fact => {
                      const hasLocation = fact.entities.some(e => 
                        ['Rieber Terrace', 'Kelton', 'Levering', 'apartment', 'lounge', 'floor', 'room', 'building', 'terrace', 'hall'].some(loc => e.includes(loc))
                      );
                      const hasPeople = fact.entities.length > 0 && !hasLocation;
                      return (
                        <div key={fact.id} className={`text-xs px-2 py-1 rounded-lg bg-[var(--card-bg)] border card shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`} style={getCardStyle(fact.category)}>
                          <span className="text-[var(--highlight-blue)] font-mono">{fact.dateStr?.replace('recurring:', '')}</span>
                          <span className="mx-1.5 text-[var(--text-meta)]">·</span>
                          <span className="text-[var(--text-on-card)]">{fact.subcategory || fact.content.slice(0, 30)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : activeViewMode === 'uploads' ? (
            /* Uploads Management View */
            <div className="animate-fade-in space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-medium text-[var(--text-on-dark)]">
                  uploads<span className="text-[var(--highlight-red)]">_</span>
                </h2>
                <button 
                  onClick={() => setShowUpload(true)}
                  className="px-4 py-2 text-sm font-mono button"
                >
                  + new upload
                </button>
              </div>
              
              {uploads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <p className="text-[var(--text-meta)]">no uploads yet</p>
                  <button onClick={() => setShowUpload(true)} className="mt-4 text-sm text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-2 transition-colors">
                    dump some text
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {uploads.map((upload) => (
                    <div 
                      key={upload.id} 
                      className={`p-4 ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-[var(--text-on-card)] truncate">
                            {upload.name}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-meta)]">
                            <span>{upload.factCount} facts</span>
                            <span>•</span>
                            <span>{new Date(upload.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-2 text-sm text-[var(--text-on-card)] line-clamp-2 opacity-80">
                            {upload.rawText.slice(0, 200)}...
                          </p>
                        </div>
                        <button
                          onClick={() => deleteUpload(upload.id)}
                          disabled={deletingUpload === upload.id}
                          className="px-3 py-1.5 text-xs text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] rounded transition-colors disabled:opacity-50"
                        >
                          {deletingUpload === upload.id ? 'deleting...' : 'delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </main>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-8 z-50 animate-fade-in" onClick={() => setShowUpload(false)}>
          <div className={`w-full max-w-2xl bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] p-6 animate-expand-in`} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-medium text-[var(--text-on-card)] mb-4">dump text<span className="text-[var(--highlight-red)]">_</span></h2>
            <textarea
              autoFocus
              placeholder="paste or type text here..."
              value={uploadText}
              onChange={(e) => setUploadText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (!uploading && uploadText.trim()) {
                    handleUpload();
                  }
                }
              }}
              rows={12}
              className="w-full px-4 py-3 rounded-lg bg-[#1c1f23] border border-[rgba(255,255,255,0.12)] text-sm text-[#f6eedf] placeholder-[rgba(246,238,223,0.45)] resize-none focus:outline-none focus:border-[var(--highlight-blue)] transition-colors font-mono"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-[var(--text-on-card)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] rounded transition-colors">cancel</button>
              <button onClick={handleUpload} disabled={uploading || !uploadText.trim()} className="px-6 py-2 text-sm font-mono button disabled:opacity-50 disabled:cursor-not-allowed">
                {uploading ? 'extracting...' : 'extract facts'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN APP
// ============================================

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>('explore');
  const [currentFilter, setCurrentFilter] = useState<BreadcrumbItem>({ type: 'all', value: '', label: 'all' });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ type: 'all', value: '', label: 'all' }]);
  const [breadcrumbClickIndex, setBreadcrumbClickIndex] = useState<number | null>(null);
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [scrollY, setScrollY] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);
  
  // Handle scroll behavior for header
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;
    
    const updateScrollDirection = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY < 10) {
        // At top, always show header
        setHeaderVisible(true);
      } else if (currentScrollY > lastScrollY) {
        // Scrolling down - hide header
        setHeaderVisible(false);
      } else if (currentScrollY < lastScrollY) {
        // Scrolling up - show header
        setHeaderVisible(true);
      }
      
      setScrollY(currentScrollY);
      lastScrollY = currentScrollY > 0 ? currentScrollY : 0;
      ticking = false;
    };
    
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateScrollDirection);
        ticking = true;
      }
    };
    
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  
  const handleHomeClick = () => {
    setViewMode('explore');
    const resetBreadcrumbs: BreadcrumbItem[] = [{ type: 'all', value: '', label: 'all' }];
    setBreadcrumbs(resetBreadcrumbs);
    setCurrentFilter(resetBreadcrumbs[0]);
    setBreadcrumbClickIndex(0);
  };
  
  const handleBreadcrumbClick = (index: number) => {
    // Always switch to explore view when navigating breadcrumbs
    setViewMode('explore');
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFilter(newBreadcrumbs[newBreadcrumbs.length - 1]);
    setBreadcrumbClickIndex(index);
  };
  
  const handlePrevMonth = () => {
    setCalendarDate(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  };
  
  const handleNextMonth = () => {
    setCalendarDate(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
  };
  
  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      {/* Top Navigation - 3 Icons + Breadcrumbs */}
      <header className={`fixed top-0 left-0 right-0 z-40 bg-[var(--bg-main)] border-b border-[var(--border-subtle)] transition-transform duration-300 ${
        headerVisible ? 'translate-y-0' : '-translate-y-full'
      }`}>
        <div className="max-w-6xl mx-auto pr-4 h-14 flex items-center justify-between">
          {/* Left: Navigation Icons + Breadcrumbs */}
          <div className="flex items-center gap-3">
            {/* Home (Inbox) - deselects when filtering - flush left */}
            <button
              onClick={handleHomeClick}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'explore' && currentFilter.type === 'all'
                  ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.18)] border border-[var(--highlight-red)]'
                  : 'text-[var(--text-sidebar)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
              }`}
              title="Home (Inbox)"
            >
              <HomeIcon className="w-5 h-5" />
            </button>
            
            {/* Calendar */}
            <button
              onClick={() => setViewMode('calendar')}
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'calendar'
                  ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.18)] border border-[var(--highlight-red)]'
                  : 'text-[var(--text-sidebar)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
              }`}
              title="Calendar"
            >
              <CalendarIcon className="w-5 h-5" />
            </button>
            
            {/* Breadcrumbs - show formatted with slashes and trailing underscore */}
            {viewMode === 'explore' && breadcrumbs.length > 0 && (
              <div className="flex items-center gap-1 ml-2 italic text-sm">
                {breadcrumbs.map((crumb, i) => (
                  <div key={i} className="flex items-center">
                    <span className="text-[var(--text-meta)]">/</span>
                    <button
                      onClick={() => handleBreadcrumbClick(i)}
                      className={`transition-colors ${
                        i === breadcrumbs.length - 1
                          ? 'text-[var(--text-on-dark)]'
                          : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] px-1 rounded'
                      }`}
                    >
                      {crumb.label}
                    </button>
                    {i === breadcrumbs.length - 1 && (
                      <span className="text-[var(--text-on-dark)]">_</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Center: Brand Name */}
          <div className="absolute left-1/2 transform -translate-x-1/2 font-extrabold text-base tracking-tight">
            <span className="text-[var(--text-on-dark)]">enclave</span>
            <span className="text-[var(--highlight-red)]">_</span>
          </div>
          
          {/* Right: Upload Icon */}
          <button
            onClick={() => setViewMode('uploads')}
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'uploads'
                ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.18)] border border-[var(--highlight-red)]'
                : 'text-[var(--text-sidebar)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
            }`}
            title="Uploads"
          >
            <UploadIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content - Full Width */}
      <main className="pt-14">
        <DumpTab 
          viewMode={viewMode} 
          setViewMode={setViewMode}
          onFilterChange={setCurrentFilter}
          onBreadcrumbsChange={setBreadcrumbs}
          breadcrumbClickIndex={breadcrumbClickIndex}
          resetBreadcrumbClick={() => setBreadcrumbClickIndex(null)}
          calendarDate={calendarDate}
          setCalendarDate={setCalendarDate}
        />
      </main>
    </div>
  );
}

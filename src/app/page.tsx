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
const getCardBorderColor = (category: string): string => {
  // Determine dominant semantic color based on category
  // People-driven categories get pink, time-driven get blue, etc.
  if (['pledging', 'meetings', 'social'].includes(category)) {
    return 'border-l-[var(--color-people)]'; // Pink for people-driven
  }
  if (['events', 'professional'].includes(category)) {
    return 'border-l-[var(--color-time)]'; // Blue for time-driven
  }
  return 'border-l-[var(--border)]';
};

const CATEGORY_BG: Record<string, string> = {
  social: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
  professional: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
  events: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
  pledging: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
  meetings: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
  other: 'bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm',
};

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
function parseSemanticText(text: string, entities: string[]): Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> {
  const parts: Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> = [];
  
  // Time patterns
  const timePattern = /(@?\w+day|@?\w+day\s+\d+(?:st|nd|rd|th)?|@?\d{1,2}:\d{2}\s*(?:AM|PM)|@?\d{1,2}:\d{2}|@?\w+\s+\d+(?:st|nd|rd|th)?|@every\s+\w+day)/gi;
  
  // Location patterns (common building/place words)
  const locationPattern = /\b(Rieber Terrace|Kelton|Levering|apartment|lounge|floor|room|building|terrace|hall)\b/gi;
  
  // People/entities
  const peoplePattern = new RegExp(`\\b(${entities.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  
  let lastIndex = 0;
  const matches: Array<{ index: number; length: number; type: 'time' | 'location' | 'people' }> = [];
  
  // Find all matches
  let match;
  while ((match = timePattern.exec(text)) !== null) {
    matches.push({ index: match.index, length: match[0].length, type: 'time' });
  }
  while ((match = locationPattern.exec(text)) !== null) {
    matches.push({ index: match.index, length: match[0].length, type: 'location' });
  }
  while ((match = peoplePattern.exec(text)) !== null) {
    matches.push({ index: match.index, length: match[0].length, type: 'people' });
  }
  
  // Sort by index
  matches.sort((a, b) => a.index - b.index);
  
  // Build parts array
  for (const m of matches) {
    if (m.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, m.index), type: 'text' });
    }
    parts.push({ text: text.slice(m.index, m.index + m.length), type: m.type });
    lastIndex = m.index + m.length;
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
  highlightClass,
  highlightBgClass,
}: { 
  text: string; 
  entities: string[]; 
  onEntityClick: (entity: string) => void;
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
            <span key={i} className="text-[var(--color-time)] font-medium">
              {part.text}
            </span>
          );
        }
        if (part.type === 'location') {
          return (
            <span key={i} className="text-[var(--color-location)] font-medium">
              {part.text}
            </span>
          );
        }
        if (part.type === 'people') {
          return (
            <button
              key={i}
              onClick={() => onEntityClick(part.text.toLowerCase())}
              className="text-[var(--color-people)] hover:underline cursor-pointer font-medium"
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


// ============================================
// INFO TAB CONTENT
// ============================================

function InfoTab({ onNavigate }: { onNavigate: (tab: AppTab) => void }) {
  return (
    <main className="min-h-screen flex flex-col animate-fade-in">
      {/* Hero Section with Image */}
      <div className="relative h-[60vh] min-h-[500px] flex items-center justify-center overflow-hidden">
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/hero-image.png)',
          }}
        >
          {/* Warm overlay matching image tones */}
          <div className="absolute inset-0 bg-gradient-to-b from-[rgba(219,203,189,0.85)] via-[rgba(219,203,189,0.75)] to-[rgba(219,203,189,0.9)]" />
        </div>
        
        {/* Content */}
        <div className="relative z-10 text-center px-8 max-w-3xl">
          <h1 className="text-6xl md:text-7xl font-light tracking-tight mb-4 text-[var(--text-primary)]">
            enclave
          </h1>
          <p className="text-lg md:text-xl text-[var(--text-secondary)] font-light mb-8 max-w-xl mx-auto">
            sms-powered announcements & polls
          </p>
          <button
            onClick={() => onNavigate('dump')}
            className="px-8 py-3 text-sm font-light tracking-wide text-[var(--bg-primary)] bg-[var(--color-action)] rounded-full hover:opacity-90 transition-all hover:scale-105 inline-flex items-center gap-2"
          >
            get started
          </button>
        </div>
      </div>

      {/* Content Section */}
      <div className="flex-1 bg-[var(--bg-primary)] py-16 px-8">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Phone Number - Minimal */}
          <div className="text-center">
            <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-2 font-light">text to activate</p>
            <p className="text-2xl md:text-3xl text-[var(--text-primary)] font-light tracking-wide">
              +1 (805) 919-8529
            </p>
          </div>

          {/* Commands - Simplified */}
          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {/* Admin */}
            <div className="space-y-4">
              <h3 className="text-sm text-[var(--text-tertiary)] uppercase tracking-wider font-light mb-4">
                admin commands
              </h3>
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <p className="text-[var(--color-action)] font-light mb-1">announce</p>
                  <p className="text-sm text-[var(--text-secondary)] font-light">meeting tonight at <span className="text-[var(--color-time)]">7pm</span></p>
                </div>
                <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <p className="text-[var(--color-action)] font-light mb-1">poll</p>
                  <p className="text-sm text-[var(--text-secondary)] font-light">who&apos;s coming <span className="text-[var(--color-time)]">friday</span>?</p>
                </div>
              </div>
            </div>

            {/* User */}
            <div className="space-y-4">
              <h3 className="text-sm text-[var(--text-tertiary)] uppercase tracking-wider font-light mb-4">
                user commands
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--color-action)] font-light">START</span>
                  <span className="text-[var(--text-tertiary)]">→</span>
                  <span className="text-[var(--text-secondary)] font-light">opt in</span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--color-action)] font-light">STOP</span>
                  <span className="text-[var(--text-tertiary)]">→</span>
                  <span className="text-[var(--text-secondary)] font-light">unsubscribe</span>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <span className="text-[var(--color-action)] font-light">HELP</span>
                  <span className="text-[var(--text-tertiary)]">→</span>
                  <span className="text-[var(--text-secondary)] font-light">commands</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer - Minimal */}
          <div className="text-center pt-8 border-t border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-tertiary)] font-light">
              powered by enclave × twilio × airtable
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

// ============================================
// DUMP TAB CONTENT (Text Explorer)
// ============================================

function DumpTab() {
  const [tree, setTree] = useState<TreeData | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [allFacts, setAllFacts] = useState<Fact[]>([]); // For calendar view - all facts
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('explore');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);
  
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { type: 'all', value: '', label: 'all' }
  ]);
  
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    categories: false,
    timeline: false,
    entities: false,
    uploads: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false); // Collapsed by default

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
    setViewMode('explore');
    // Close sidebar on mobile after navigation
    setSidebarOpen(false);
    
    if (type === 'all') {
      setBreadcrumbs([{ type: 'all', value: '', label: 'all' }]);
      setExpandedCards({});
    } else if (type === 'subcategory' && parent) {
      setBreadcrumbs([
        { type: 'all', value: '', label: 'all' },
        { type: 'category', value: parent, label: parent },
        { type, value, label, parent }
      ]);
    } else {
      setBreadcrumbs([
        { type: 'all', value: '', label: 'all' },
        { type, value, label }
      ]);
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

  // Group facts by subcategory
  const groupedFacts = useMemo(() => {
    const groups: Record<string, Fact[]> = {};
    const ungrouped: Fact[] = [];
    
    for (const fact of facts) {
      if (fact.subcategory) {
        const key = fact.subcategory.toLowerCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(fact);
      } else {
        ungrouped.push(fact);
      }
    }
    
    return { groups, ungrouped };
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
    <div className="min-h-screen bg-[var(--bg-primary)] flex animate-fade-in">
      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-[rgba(114,95,69,0.5)] z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed top-0 left-0 h-full w-72 border-r border-[var(--border-subtle)] bg-[var(--bg-primary)] flex flex-col z-40 transition-transform duration-300`}>
        <div className="p-6 border-b border-[var(--border-subtle)]">
          <h1 className="text-lg font-light text-[var(--text-primary)] tracking-tight">
            dump<span className="text-[var(--color-action)]">_</span>
          </h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{tree?.totalFacts ?? 0} facts</p>
        </div>

        {/* View Tabs */}
        <div className="px-4 pt-4 flex gap-1">
          {(['explore', 'calendar', 'uploads'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex-1 px-2 py-2 text-xs font-medium rounded transition-colors ${
                viewMode === mode
                  ? 'bg-[var(--color-time)] text-[var(--bg-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-auto py-4">
          {/* All */}
          <button
            onClick={() => navigateTo('all', '', 'all')}
            className={`w-full text-left px-6 py-2 text-sm transition-colors ${
              currentFilter.type === 'all' ? 'text-[var(--color-time)] bg-[var(--color-time-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className="opacity-50 mr-2">~</span>all
          </button>

          {/* Categories */}
          <div className="mt-3">
            <button onClick={() => toggleSection('categories')} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-2">
              <span className={`transition-transform ${expandedSections.categories ? 'rotate-90' : ''}`}>▸</span>
              categories
            </button>
            {expandedSections.categories && tree?.categories.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center">
                  {cat.subcategories.length > 0 && (
                    <button onClick={() => toggleCategory(cat.name)} className="pl-6 pr-1 py-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                      <span className={`text-xs transition-transform inline-block ${expandedCategories[cat.name] ? 'rotate-90' : ''}`}>▸</span>
                    </button>
                  )}
                  <button
                    onClick={() => navigateTo('category', cat.name, cat.name)}
                    className={`flex-1 text-left ${cat.subcategories.length > 0 ? 'pl-1' : 'pl-6'} pr-6 py-1.5 text-sm transition-colors ${
                      currentFilter.type === 'category' && currentFilter.value === cat.name ? 'text-[var(--color-people)] bg-[var(--color-people-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {!cat.subcategories.length && <span className="opacity-30 mr-2">├─</span>}
                    <span className={CATEGORY_COLORS[cat.name] || ''}>{cat.name}</span>
                    <span className="text-[var(--text-tertiary)] ml-2 text-xs">{cat.count}</span>
                  </button>
                </div>
                {expandedCategories[cat.name] && cat.subcategories.map((sub) => (
                  <button
                    key={sub.name}
                    onClick={() => navigateTo('subcategory', sub.name, sub.name, cat.name)}
                    className={`w-full text-left pl-12 pr-6 py-1 text-sm transition-colors ${
                      currentFilter.type === 'subcategory' && currentFilter.value === sub.name ? 'text-[var(--color-people)] bg-[var(--color-people-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <span className="opacity-30 mr-2">└─</span>{sub.name}
                    <span className="text-[var(--text-tertiary)] ml-2 text-xs">{sub.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Timeline */}
          {tree?.timeRefs && tree.timeRefs.length > 0 && (
            <div className="mt-3">
              <button onClick={() => toggleSection('timeline')} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-2">
                <span className={`transition-transform ${expandedSections.timeline ? 'rotate-90' : ''}`}>▸</span>
                timeline
              </button>
              {expandedSections.timeline && (
                <div className="px-6 py-2">
                  <div className="space-y-1">
                    {tree.timeRefs.filter(t => t.dateStr && !t.dateStr.startsWith('recurring:')).map((timeRef) => {
                      const date = new Date(timeRef.dateStr!);
                      const isValid = !isNaN(date.getTime());
                      return (
                        <button
                          key={timeRef.name}
                          onClick={() => navigateTo('time', timeRef.name, timeRef.name)}
                          className={`w-full text-left py-1 text-xs transition-colors flex items-center gap-2 ${
                            currentFilter.type === 'time' && currentFilter.value === timeRef.name ? 'text-[var(--accent-contrast)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {isValid && (
                            <span className="w-12 text-[var(--accent-contrast)] font-medium">
                              {MONTHS[date.getMonth()]} {date.getDate()}
                            </span>
                          )}
                          <span className="truncate">{timeRef.name}</span>
                        </button>
                      );
                    })}
                    {/* Recurring */}
                    {tree.timeRefs.filter(t => t.dateStr?.startsWith('recurring:')).length > 0 && (
                      <div className="pt-2 mt-2 border-t border-[var(--border-subtle)]">
                        <span className="text-[10px] text-[var(--text-tertiary)] uppercase">recurring</span>
                        {tree.timeRefs.filter(t => t.dateStr?.startsWith('recurring:')).map((timeRef) => (
                          <button
                            key={timeRef.name}
                            onClick={() => navigateTo('time', timeRef.name, timeRef.name)}
                            className={`w-full text-left py-1 text-xs transition-colors flex items-center gap-2 ${
                              currentFilter.type === 'time' && currentFilter.value === timeRef.name ? 'text-[var(--color-time)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <span className="w-12 text-[var(--text-tertiary)]">↻</span>
                            <span className="truncate">{timeRef.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Entities */}
          {tree?.entities && tree.entities.length > 0 && (
            <div className="mt-3">
              <button onClick={() => toggleSection('entities')} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-2">
                <span className={`transition-transform ${expandedSections.entities ? 'rotate-90' : ''}`}>▸</span>
                entities
              </button>
              {expandedSections.entities && tree.entities.slice(0, 15).map((entity) => (
                <button
                  key={entity.name}
                  onClick={() => navigateTo('entity', entity.name.toLowerCase(), entity.name)}
                  className={`w-full text-left px-6 py-1.5 text-sm transition-colors ${
                    currentFilter.type === 'entity' && currentFilter.value.toLowerCase() === entity.name.toLowerCase() ? 'text-[var(--accent)] bg-[var(--accent-glow)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="opacity-30 mr-2">├─</span>{entity.name}
                  <span className="text-[var(--text-tertiary)] ml-2 text-xs">{entity.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Uploads */}
          {uploads.length > 0 && (
            <div className="mt-3">
              <button onClick={() => toggleSection('uploads')} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-2">
                <span className={`transition-transform ${expandedSections.uploads ? 'rotate-90' : ''}`}>▸</span>
                uploads ({uploads.length})
              </button>
              {expandedSections.uploads && uploads.slice(0, 10).map((upload) => (
                <button
                  key={upload.id}
                  onClick={() => setViewMode('uploads')}
                  className="w-full text-left px-6 py-1.5 text-sm transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <span className="opacity-30 mr-2">📄</span>
                  <span className="truncate">{upload.name.slice(0, 20)}</span>
                  <span className="text-[var(--text-tertiary)] ml-2 text-xs">{upload.factCount}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-[var(--border-subtle)]">
          <button onClick={() => setShowUpload(true)} className="w-full px-4 py-2.5 text-sm font-medium text-[var(--bg-primary)] bg-[var(--color-action)] rounded hover:opacity-90 transition-colors">
            + dump text
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarOpen ? 'lg:ml-72' : 'lg:ml-0'}`}>
        <header className="px-8 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Menu Icon Button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              aria-label="Toggle sidebar"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-[var(--text-tertiary)]">/</span>}
                <button
                  onClick={() => {
                    if (i === 0) navigateTo('all', '', 'all');
                    else if (i === 1 && crumb.type === 'category') navigateTo('category', crumb.value, crumb.label);
                  }}
                  className={`text-sm ${i === breadcrumbs.length - 1 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--color-time)]'}`}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
            <span className="text-[var(--text-tertiary)] ml-2 text-xs">({facts.length})</span>
          </div>
          
          {viewMode === 'calendar' && (
            <div className="flex items-center gap-4">
              <button onClick={() => setCalendarDate(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })} className="text-[var(--text-secondary)] hover:text-[var(--color-time)] px-2">←</button>
              <span className="text-sm text-[var(--text-primary)] min-w-[120px] text-center">{MONTHS[calendarDate.month]} {calendarDate.year}</span>
              <button onClick={() => setCalendarDate(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })} className="text-[var(--text-secondary)] hover:text-[var(--color-time)] px-2">→</button>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-auto p-8">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <span className="text-[var(--text-tertiary)] animate-pulse">loading...</span>
            </div>
          ) : viewMode === 'explore' ? (
            facts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-[var(--text-tertiary)]">no facts yet</p>
                <button onClick={() => setShowUpload(true)} className="mt-4 text-sm text-[var(--color-action)] hover:underline">dump some text</button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Grouped facts */}
                {Object.entries(groupedFacts.groups).map(([subcategory, groupFacts]) => {
                  const isExpanded = expandedCards[subcategory];
                  const mainFact = groupFacts[0];
                  
                  return (
                    <div key={subcategory} className="animate-slide-in">
                      <div className={`rounded-lg ${CATEGORY_BG[mainFact.category] || CATEGORY_BG.other} ${getCardBorderColor(mainFact.category)} border-l-4 overflow-hidden`}>
                        {/* Header */}
                        <button
                          onClick={() => toggleCard(subcategory)}
                          className="w-full p-4 text-left flex items-start justify-between gap-4 hover:bg-[var(--bg-hover)] transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-medium text-[var(--color-people)]">
                                {subcategory}
                              </span>
                              {mainFact.timeRef && (
                                <span className="text-xs text-[var(--color-time)] font-medium">@{mainFact.timeRef}</span>
                              )}
                              {mainFact.entities.some(e => ['Rieber Terrace', 'Kelton', 'Levering', 'apartment', 'lounge'].some(loc => e.includes(loc))) && (
                                <span className="text-xs text-[var(--color-location)] font-medium">📍</span>
                              )}
                              <span className="text-xs text-[var(--text-tertiary)]">({groupFacts.length})</span>
                            </div>
                            <p className="text-sm text-[var(--text-primary)] font-light">{mainFact.content}</p>
                          </div>
                          <span className={`text-[var(--text-tertiary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            ▾
                          </span>
                        </button>
                        
                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="border-t border-[var(--border-subtle)] p-4 space-y-4 animate-slide-in">
                            {groupFacts.map((fact) => (
                              <div key={fact.id} className="text-sm">
                                {fact.sourceText && (
                                  <p className="text-[var(--text-primary)] leading-relaxed mb-3 font-light">
                                    <HighlightedText 
                                      text={fact.sourceText} 
                                      entities={fact.entities}
                                      onEntityClick={(e) => {
                                        navigateTo('entity', e.toLowerCase(), e);
                                        // Auto-expand the card when clicking an entity within it
                                        if (fact.subcategory) {
                                          const key = fact.subcategory.toLowerCase();
                                          setExpandedCards(prev => ({ ...prev, [key]: true }));
                                        }
                                      }}
                                    />
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                  {fact.entities.slice(0, 8).map((entity) => (
                                    <button
                                      key={entity}
                                      onClick={() => {
                                        navigateTo('entity', entity.toLowerCase(), entity);
                                        // Auto-expand the card when clicking an entity tag
                                        if (fact.subcategory) {
                                          const key = fact.subcategory.toLowerCase();
                                          setExpandedCards(prev => ({ ...prev, [key]: true }));
                                        }
                                      }}
                                      className="text-xs px-2 py-0.5 rounded bg-[var(--color-people-light)] text-[var(--color-people)] hover:bg-[var(--color-people-light)] transition-colors font-medium"
                                    >
                                      #{entity}
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
                })}
                
                {/* Ungrouped facts */}
                {groupedFacts.ungrouped.map((fact) => (
                  <div key={fact.id} className={`p-4 rounded-lg ${CATEGORY_BG[fact.category] || CATEGORY_BG.other} ${getCardBorderColor(fact.category)} border-l-4 animate-slide-in`}>
                    <p className="text-[var(--text-primary)] text-sm leading-relaxed mb-3 font-light">
                      <HighlightedText 
                        text={fact.sourceText || fact.content} 
                        entities={fact.entities}
                        onEntityClick={(e) => {
                          navigateTo('entity', e.toLowerCase(), e);
                          // For ungrouped facts, we can't auto-expand but we ensure filtering works
                        }}
                      />
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-[var(--text-tertiary)] uppercase tracking-wide">{fact.category}</span>
                      {fact.timeRef && (
                        <button onClick={() => navigateTo('time', fact.timeRef!.toLowerCase(), fact.timeRef!)} className="text-[var(--color-time)] hover:underline font-medium">
                          @{fact.timeRef}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : viewMode === 'calendar' ? (
            /* Calendar View */
            <div className="animate-fade-in">
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="text-center text-xs text-[var(--text-tertiary)] py-2">{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1" key={`calendar-${allFacts.length}-${calendarDate.year}-${calendarDate.month}`}>
                {calendarDays.map((day, i) => {
                  const dayFacts = day ? getFactsForDay(day) : [];
                  const isToday = day && new Date().getDate() === day && new Date().getMonth() === calendarDate.month && new Date().getFullYear() === calendarDate.year;
                  
                  return (
                    <div key={i} className={`min-h-[100px] p-2 rounded-lg border transition-colors ${day ? 'border-[var(--border-subtle)] hover:border-[var(--border)] bg-[var(--bg-card)]' : 'border-transparent'} ${isToday ? 'ring-1 ring-[var(--color-time)]' : ''}`}>
                      {day && (
                        <>
                          <div className={`text-xs mb-1 ${isToday ? 'text-[var(--color-time)] font-medium' : 'text-[var(--text-tertiary)]'}`}>{day}</div>
                          <div className="space-y-1">
                            {dayFacts.slice(0, 3).map((fact) => (
                              <div key={fact.id} className="text-[10px] px-1.5 py-0.5 rounded truncate bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)]" title={fact.content}>
                                {fact.subcategory || fact.content.slice(0, 20)}
                              </div>
                            ))}
                            {dayFacts.length > 3 && <div className="text-[10px] text-[var(--text-tertiary)]">+{dayFacts.length - 3}</div>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {recurringFacts.length > 0 && (
                <div className="mt-6 p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-3">↻ recurring</h3>
                  <div className="flex flex-wrap gap-2">
                    {recurringFacts.map(fact => (
                      <div key={fact.id} className="text-xs px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                        <span className="text-[var(--color-time)] font-medium">{fact.dateStr?.replace('recurring:', '')}</span>
                        <span className="mx-1.5 text-[var(--text-tertiary)]">·</span>
                        <span className="text-[var(--color-people)]">{fact.subcategory || fact.content.slice(0, 30)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : viewMode === 'uploads' ? (
            /* Uploads Management View */
            <div className="animate-fade-in space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-medium text-[var(--text-primary)]">
                  uploads<span className="text-[var(--color-action)]">_</span>
                </h2>
                <button 
                  onClick={() => setShowUpload(true)}
                  className="px-4 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--color-action)] rounded hover:opacity-90 transition-colors"
                >
                  + new upload
                </button>
              </div>
              
              {uploads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <p className="text-[var(--text-tertiary)]">no uploads yet</p>
                  <button onClick={() => setShowUpload(true)} className="mt-4 text-sm text-[var(--accent)] hover:underline">
                    dump some text
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {uploads.map((upload) => (
                    <div 
                      key={upload.id} 
                      className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border)] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-[var(--text-primary)] truncate">
                            {upload.name}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-tertiary)]">
                            <span>{upload.factCount} facts</span>
                            <span>•</span>
                            <span>{new Date(upload.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="mt-2 text-sm text-[var(--text-secondary)] line-clamp-2">
                            {upload.rawText.slice(0, 200)}...
                          </p>
                        </div>
                        <button
                          onClick={() => deleteUpload(upload.id)}
                          disabled={deletingUpload === upload.id}
                          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50"
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
        <div className="fixed inset-0 bg-[rgba(114,95,69,0.8)] flex items-center justify-center p-8 z-50 animate-fade-in" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-2xl bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 animate-expand-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">dump text<span className="text-[var(--color-time)]">_</span></h2>
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
              className="w-full px-4 py-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--color-time)] transition-colors"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">cancel</button>
              <button onClick={handleUpload} disabled={uploading || !uploadText.trim()} className="px-6 py-2 text-sm font-medium text-[var(--bg-primary)] bg-[var(--color-action)] rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
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
// MAIN APP WITH TABS
// ============================================

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>('info');

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Global Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-[var(--bg-primary)]/90 backdrop-blur-sm border-b border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left: Home Icon */}
          <button
            onClick={() => setActiveTab('dump')}
            className={`p-2 rounded-lg transition-colors ${
              activeTab === 'dump' 
                ? 'text-[var(--color-time)] bg-[var(--color-time-light)]' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
            title="Text Explorer"
          >
            <HomeIcon className="w-5 h-5" />
          </button>

          {/* Center: App Name */}
          <h1 className="text-lg font-light tracking-tight">
            <span className="text-[var(--text-primary)]">enclave</span>
          </h1>

          {/* Right: Help Icon */}
          <button
            onClick={() => setActiveTab('info')}
            className={`p-2 rounded-lg transition-colors ${
              activeTab === 'info' 
                ? 'text-[var(--color-time)] bg-[var(--color-time-light)]' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
            title="How It Works"
          >
            <HelpIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content Area - offset for fixed header */}
      <div className="pt-14">
        {activeTab === 'info' && <InfoTab onNavigate={setActiveTab} />}
        {activeTab === 'dump' && <DumpTab />}
      </div>
    </div>
  );
}

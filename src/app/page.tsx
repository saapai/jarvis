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
const CARD_BG = 'bg-[var(--card-bg)] border border-[var(--card-border)] rounded-[var(--card-radius)] shadow-[var(--card-shadow)]';

// Category color overlays - more prominent red or blue wash
const CATEGORY_OVERLAY: Record<string, string> = {
  social: 'rgba(206, 96, 135, 0.18)', // stronger red overlay
  professional: 'rgba(59, 124, 150, 0.18)', // stronger blue overlay
  events: 'rgba(206, 96, 135, 0.18)', // stronger red overlay
  pledging: 'rgba(59, 124, 150, 0.18)', // stronger blue overlay
  meetings: 'rgba(59, 124, 150, 0.18)', // stronger blue overlay
  other: 'rgba(206, 96, 135, 0.18)', // stronger red overlay
};

const getCardStyle = (category?: string) => {
  const overlay = category ? CATEGORY_OVERLAY[category.toLowerCase()] || CATEGORY_OVERLAY.other : CATEGORY_OVERLAY.other;
  return {
    background: `linear-gradient(${overlay}, ${overlay}), var(--card-bg)`,
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
function parseSemanticText(text: string, entities: string[]): Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> {
  const parts: Array<{ text: string; type: 'time' | 'location' | 'people' | 'text' }> = [];
  
  if (!text) return [{ text, type: 'text' }];
  
  // Time patterns - more specific to avoid overlaps
  const timePattern = /(@?\w+day|@?\w+day\s+\d+(?:st|nd|rd|th)?|@?\d{1,2}:\d{2}\s*(?:AM|PM)|@?\d{1,2}:\d{2}|@?\w+\s+\d+(?:st|nd|rd|th)?|@every\s+\w+day)/gi;
  
  // Location patterns (common building/place words)
  const locationPattern = /\b(Rieber Terrace|Kelton|Levering|apartment|lounge|floor|room|building|terrace|hall)\b/gi;
  
  // People/entities - sort by length descending to match longest first
  const sortedEntities = [...entities].sort((a, b) => b.length - a.length);
  const peoplePattern = sortedEntities.length > 0 
    ? new RegExp(`\\b(${sortedEntities.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
    : null;
  
  const matches: Array<{ index: number; endIndex: number; type: 'time' | 'location' | 'people'; text: string }> = [];
  
  // Find all matches with their positions
  let match;
  const usedRanges = new Set<string>();
  
  // Helper to check if range overlaps with existing matches
  const addMatch = (index: number, length: number, type: 'time' | 'location' | 'people', matchedText: string) => {
    const endIndex = index + length;
    const rangeKey = `${index}-${endIndex}`;
    
    // Check for overlaps - if this range overlaps with any existing match, skip it
    const overlaps = matches.some(m => 
      (index >= m.index && index < m.endIndex) || 
      (endIndex > m.index && endIndex <= m.endIndex) ||
      (index <= m.index && endIndex >= m.endIndex)
    );
    
    if (!overlaps && !usedRanges.has(rangeKey)) {
      matches.push({ index, endIndex, type, text: matchedText });
      usedRanges.add(rangeKey);
    }
  };
  
  // Find time matches
  timePattern.lastIndex = 0;
  while ((match = timePattern.exec(text)) !== null) {
    addMatch(match.index, match[0].length, 'time', match[0]);
  }
  
  // Find location matches
  locationPattern.lastIndex = 0;
  while ((match = locationPattern.exec(text)) !== null) {
    addMatch(match.index, match[0].length, 'location', match[0]);
  }
  
  // Find people/entity matches (prioritize longest matches first)
  if (peoplePattern) {
    peoplePattern.lastIndex = 0;
    while ((match = peoplePattern.exec(text)) !== null) {
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
            <span key={i} className="text-[var(--highlight-blue)] font-mono">
              {part.text}
            </span>
          );
        }
        if (part.type === 'location') {
          return (
            <span key={i} className="text-[var(--highlight-blue)] font-mono">
              {part.text}
            </span>
          );
        }
        if (part.type === 'people') {
          return (
            <button
              key={i}
              onClick={() => onEntityClick(part.text.toLowerCase())}
              className="text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-1 cursor-pointer font-mono transition-colors"
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
    <main className="min-h-screen flex flex-col animate-fade-in bg-[var(--bg-main)]">
      {/* Hero Section */}
      <div className="relative h-[25vh] min-h-[250px] flex items-center justify-center overflow-hidden">
        {/* Background Image with soft vignette */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/hero-image.png)',
          }}
        />
        {/* Soft vignette overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg-main)] opacity-80" />
        
        {/* Content */}
        <div className="relative z-10 text-center px-8 max-w-4xl w-full">
          {/* Timestamp in mono */}
          <p className="text-xs text-[var(--text-on-dark)]/80 mb-3 font-mono tracking-wider">
            Winter Week 10 · SEP Lore
          </p>
          {/* Large title */}
          <h1 className="text-6xl md:text-7xl font-display mb-2 text-[var(--text-on-dark)] leading-[0.9]">
            Enclave
          </h1>
          {/* Thin blue underline - highlighter streak */}
          <div className="w-32 h-1 bg-[var(--highlight-blue)] mx-auto mb-8 opacity-80" />
        </div>
      </div>

      {/* Section 1: What Enclave Is */}
      <section className="py-24 px-8 bg-[var(--bg-main)]">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-display text-[var(--text-on-dark)] mb-4">
            SMS-powered memory
          </h2>
          <p className="text-base md:text-lg text-[var(--text-on-dark)] font-light leading-relaxed max-w-2xl mx-auto opacity-90">
            Enclave transforms text messages into structured knowledge. Announcements become memories. Polls become decisions. Conversations become archives.
          </p>
        </div>
      </section>

      {/* Section 2: How It Works */}
      <section className="py-24 px-8 bg-[var(--bg-main)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-display text-[var(--text-on-dark)] mb-12 text-center">
            how it works
          </h2>
          
          <div className="space-y-8">
            {/* Admin Commands */}
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--text-meta)] mb-4 font-mono">
                admin
              </p>
              <div className={`bg-[var(--card-bg)] rounded-[var(--card-radius)] p-6 border border-[var(--card-border)] shadow-[var(--card-shadow)] card space-y-4`}>
                <div className="flex items-start gap-2">
                  <span className="text-[var(--highlight-red)] font-mono text-sm">$</span>
                  <div className="flex-1">
                    <span className="text-[var(--highlight-red)] font-mono text-sm">announce</span>
                    <span className="text-[var(--text-on-card)] ml-2">meeting tonight at</span>
                    <span className="text-[var(--highlight-blue)] font-mono text-sm ml-1">7pm</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[var(--highlight-red)] font-mono text-sm">$</span>
                  <div className="flex-1">
                    <span className="text-[var(--highlight-red)] font-mono text-sm">poll</span>
                    <span className="text-[var(--text-on-card)] ml-2">who&apos;s coming</span>
                    <span className="text-[var(--highlight-blue)] font-mono text-sm ml-1">friday</span>
                    <span className="text-[var(--text-on-card)] ml-1">?</span>
                  </div>
                </div>
              </div>
            </div>

            {/* User Commands */}
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--text-meta)] mb-4 font-mono">
                user
              </p>
              <div className={`bg-[var(--card-bg)] rounded-[var(--card-radius)] p-6 border border-[var(--card-border)] shadow-[var(--card-shadow)] card space-y-3`}>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--highlight-red)] font-mono text-sm">START</span>
                  <span className="text-[var(--text-meta)]">→</span>
                  <span className="text-[var(--text-on-card)]">opt in</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--highlight-red)] font-mono text-sm">STOP</span>
                  <span className="text-[var(--text-meta)]">→</span>
                  <span className="text-[var(--text-on-card)]">unsubscribe</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--highlight-red)] font-mono text-sm">HELP</span>
                  <span className="text-[var(--text-meta)]">→</span>
                  <span className="text-[var(--text-on-card)]">commands</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Why It Matters */}
      <section className="py-32 px-8 bg-[var(--bg-main)]">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h2 className="text-3xl md:text-4xl font-display text-[var(--color-location)] mb-4">
            why it matters
          </h2>
          <p className="text-lg text-[var(--text-primary)] font-light leading-relaxed">
            Every message is a memory. Every poll is a decision. Every announcement is a moment preserved. Enclave helps your community remember what matters.
          </p>
        </div>
      </section>

      {/* Phone Number - Clean & Minimal */}
      <section className="py-24 px-8 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xs uppercase tracking-widest text-[var(--text-tertiary)] mb-4 font-light">text to activate</p>
          <p className="text-3xl md:text-4xl text-[var(--color-location)] font-display">
            +1 (805) 919-8529
          </p>
        </div>
      </section>

      {/* Footer - Minimal */}
      <footer className="py-12 px-8 bg-[var(--bg-main)] border-t border-[var(--border-subtle)]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs text-[var(--text-tertiary)] font-light">
            powered by enclave × twilio × airtable
          </p>
        </div>
      </footer>
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
    <div className="min-h-screen bg-[var(--bg-main)] flex animate-fade-in">
      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed top-0 left-0 h-full w-72 border-r border-[rgba(255,255,255,0.04)] bg-[var(--bg-secondary)] flex flex-col z-40 transition-transform duration-300`}>
        <div className="p-6 border-b border-[rgba(255,255,255,0.04)]">
          <h1 className="text-lg font-medium text-[var(--text-on-dark)] tracking-tight">
            dump<span className="text-[var(--highlight-red)]">_</span>
          </h1>
          <p className="text-xs text-[var(--text-sidebar)] mt-1 font-mono opacity-70">{tree?.totalFacts ?? 0} facts</p>
        </div>

        {/* View Tabs */}
        <div className="px-4 pt-4 flex gap-1">
          {(['explore', 'calendar', 'uploads'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex-1 px-2 py-2 text-xs font-mono rounded transition-colors button ${
                viewMode === mode
                  ? 'bg-[rgba(206,96,135,0.18)] text-[var(--highlight-red)] border-[var(--highlight-red)]'
                  : 'text-[var(--text-on-dark)] hover:bg-[rgba(206,96,135,0.18)] hover:text-[var(--highlight-red)] hover:border-[var(--highlight-red)]'
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
              currentFilter.type === 'all' ? 'bg-[var(--bg-active)] text-[var(--text-on-dark)] font-medium rounded-md mx-2' : 'text-[var(--text-sidebar)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-on-dark)]'
            }`}
          >
            <span className="opacity-50 mr-2">~</span>all
          </button>

          {/* Categories */}
          <div className="mt-3">
            <button onClick={() => toggleSection('categories')} className="w-full text-left px-6 py-2 text-xs uppercase tracking-wider text-[var(--text-sidebar)] opacity-70 hover:opacity-100 hover:text-[var(--text-on-dark)] flex items-center gap-2">
              <span className={`transition-transform ${expandedSections.categories ? 'rotate-90' : ''}`}>▸</span>
              categories
            </button>
            {expandedSections.categories && tree?.categories.map((cat) => (
              <div key={cat.name}>
                <div className="flex items-center">
                  {cat.subcategories.length > 0 && (
                    <button onClick={() => toggleCategory(cat.name)} className="pl-6 pr-1 py-1.5 text-[var(--text-meta)] hover:text-[var(--text-on-dark)]">
                      <span className={`text-xs transition-transform inline-block ${expandedCategories[cat.name] ? 'rotate-90' : ''}`}>▸</span>
                    </button>
                  )}
                  <button
                    onClick={() => navigateTo('category', cat.name, cat.name)}
                    className={`flex-1 text-left ${cat.subcategories.length > 0 ? 'pl-1' : 'pl-6'} pr-6 py-1.5 text-sm transition-colors ${
                      currentFilter.type === 'category' && currentFilter.value === cat.name ? 'bg-[var(--bg-active)] text-[var(--text-on-dark)] font-medium rounded-md mr-2' : 'text-[var(--text-sidebar)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-on-dark)]'
                    }`}
                  >
                    {!cat.subcategories.length && <span className="opacity-30 mr-2">├─</span>}
                    <span>{cat.name}</span>
                    <span className="text-[var(--text-meta)] ml-2 text-xs">{cat.count}</span>
                  </button>
                </div>
                {expandedCategories[cat.name] && cat.subcategories.map((sub) => (
                  <button
                    key={sub.name}
                    onClick={() => navigateTo('subcategory', sub.name, sub.name, cat.name)}
                    className={`w-full text-left pl-12 pr-6 py-1 text-sm transition-colors ${
                      currentFilter.type === 'subcategory' && currentFilter.value === sub.name ? 'text-[var(--highlight-blue)] bg-[rgba(52,124,147,0.16)]' : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
                    }`}
                  >
                    <span className="opacity-30 mr-2">└─</span>{sub.name}
                    <span className="text-[var(--text-meta)] ml-2 text-xs">{sub.count}</span>
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
                            currentFilter.type === 'time' && currentFilter.value === timeRef.name ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.16)]' : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
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
                        <span className="text-[10px] text-[var(--text-meta)] uppercase">recurring</span>
                        {tree.timeRefs.filter(t => t.dateStr?.startsWith('recurring:')).map((timeRef) => (
                          <button
                            key={timeRef.name}
                            onClick={() => navigateTo('time', timeRef.name, timeRef.name)}
                            className={`w-full text-left py-1 text-xs transition-colors flex items-center gap-2 ${
                              currentFilter.type === 'time' && currentFilter.value === timeRef.name ? 'text-[var(--highlight-blue)] bg-[rgba(52,124,147,0.16)]' : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-blue)] hover:bg-[rgba(52,124,147,0.16)]'
                            }`}
                          >
                            <span className="w-12 text-[var(--text-meta)]">↻</span>
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
                    currentFilter.type === 'entity' && currentFilter.value.toLowerCase() === entity.name.toLowerCase() ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.16)]' : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
                  }`}
                >
                  <span className="opacity-30 mr-2">├─</span>{entity.name}
                  <span className="text-[var(--text-meta)] ml-2 text-xs">{entity.count}</span>
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
                  className="w-full text-left px-6 py-1.5 text-sm transition-colors text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]"
                >
                  <span className="opacity-30 mr-2">📄</span>
                  <span className="truncate">{upload.name.slice(0, 20)}</span>
                  <span className="text-[var(--text-meta)] ml-2 text-xs">{upload.factCount}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-[var(--border-subtle)]">
          <button onClick={() => setShowUpload(true)} className="w-full px-4 py-2.5 text-sm font-mono button">
            + dump text
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidebarOpen ? 'lg:ml-72' : 'lg:ml-0'}`}>
        <header className="px-8 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-main)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Menu Icon Button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] transition-colors"
              aria-label="Toggle sidebar"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-[var(--text-meta)]">/</span>}
                <button
                  onClick={() => {
                    if (i === 0) navigateTo('all', '', 'all');
                    else if (i === 1 && crumb.type === 'category') navigateTo('category', crumb.value, crumb.label);
                  }}
                  className={`text-sm ${i === breadcrumbs.length - 1 ? 'text-[var(--text-on-dark)]' : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'}`}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
            <span className="text-[var(--text-meta)] ml-2 text-xs">({facts.length})</span>
          </div>
          
          {viewMode === 'calendar' && (
            <div className="flex items-center gap-4">
              <button onClick={() => setCalendarDate(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })} className="text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] px-2 rounded transition-colors">←</button>
              <span className="text-sm text-[var(--text-on-dark)] min-w-[120px] text-center">{MONTHS[calendarDate.month]} {calendarDate.year}</span>
              <button onClick={() => setCalendarDate(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })} className="text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] px-2 rounded transition-colors">→</button>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-auto p-8">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <span className="text-[var(--text-meta)] animate-pulse">loading...</span>
            </div>
          ) : viewMode === 'explore' ? (
            facts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-[var(--text-meta)]">no facts yet</p>
                <button onClick={() => setShowUpload(true)} className="mt-4 text-sm text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)] hover:rounded px-2 transition-colors">dump some text</button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Grouped facts */}
                {Object.entries(groupedFacts.groups).map(([subcategory, groupFacts]) => {
                  const isExpanded = expandedCards[subcategory];
                  const mainFact = groupFacts[0];
                  
                  return (
                    <div key={subcategory} className="animate-slide-in">
                      <div 
                        className={`${CARD_BG} ${CARD_CLASS} overflow-hidden`}
                        style={getCardStyle(mainFact.category)}
                      >
                        {/* Header */}
                        <button
                          onClick={() => toggleCard(subcategory)}
                          className="w-full p-4 text-left flex items-start justify-between gap-4 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-3">
                              <h3 className="text-sm font-medium text-[var(--text-on-card-title)] card-title">
                                {subcategory}
                              </h3>
                              {mainFact.timeRef && (
                                <span className="text-xs text-[var(--highlight-blue)] font-mono">@{mainFact.timeRef}</span>
                              )}
                              <span className="text-xs text-[var(--text-meta)] font-mono">({groupFacts.length})</span>
                            </div>
                            <p className="text-sm text-[var(--text-on-card)] font-light leading-relaxed">{mainFact.content}</p>
                          </div>
                          <span className={`text-[var(--text-meta)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            ▾
                          </span>
                        </button>
                        
                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="border-t border-[var(--card-border)] p-4 space-y-4 animate-slide-in">
                            {groupFacts.map((fact) => (
                              <div key={fact.id} className="text-sm">
                                {fact.sourceText && (
                                  <p className="text-[var(--text-on-card)] leading-relaxed mb-3 font-light">
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
                })}
                
                {/* Ungrouped facts */}
                {groupedFacts.ungrouped.map((fact) => (
                  <div 
                    key={fact.id} 
                    className={`p-4 ${CARD_BG} ${CARD_CLASS} animate-slide-in`}
                    style={getCardStyle(fact.category)}
                  >
                    <p className="text-[var(--text-on-card)] text-sm leading-relaxed mb-3 font-light">
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
                      <span className="text-[var(--text-meta)] uppercase tracking-wide font-mono">{fact.category}</span>
                      {fact.timeRef && (
                        <button onClick={() => navigateTo('time', fact.timeRef!.toLowerCase(), fact.timeRef!)} className="text-[var(--highlight-blue)] hover:bg-[rgba(52,124,147,0.16)] hover:rounded px-1 font-mono transition-colors">
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
                                <div
                                  key={fact.id}
                                  className={`text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--card-border)] card truncate`}
                                  style={getCardStyle(fact.category)}
                                  title={fact.content}
                                >
                                  <span className="text-[var(--text-on-card)]">
                                    {fact.subcategory || fact.content.slice(0, 20)}
                                  </span>
                                  {fact.timeRef && (
                                    <span className="text-[var(--highlight-blue)] ml-1 font-mono">@{fact.timeRef.slice(0, 8)}</span>
                                  )}
                                </div>
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
                  className="mt-6 p-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] card"
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
                        <div key={fact.id} className={`text-xs px-2 py-1 rounded bg-[var(--card-bg)] border border-[var(--card-border)] card`}>
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
          ) : viewMode === 'uploads' ? (
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
                      className={`p-4 ${CARD_BG} ${CARD_CLASS}`}
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
          <div className={`w-full max-w-2xl bg-[var(--card-bg)] rounded-[var(--card-radius)] border border-[var(--card-border)] shadow-[var(--card-shadow)] p-6 animate-expand-in`} onClick={(e) => e.stopPropagation()}>
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
// MAIN APP WITH TABS
// ============================================

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>('info');

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
      {/* Global Navigation Header - Simplified for Landing */}
      {activeTab === 'info' ? (
        <header className="fixed top-0 left-0 right-0 z-40 bg-transparent">
          <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-start">
            {/* Left: CTA */}
            <button
              onClick={() => setActiveTab('dump')}
              className="p-2 rounded-lg transition-colors text-[var(--text-on-dark)]/90 hover:text-[var(--text-on-dark)] hover:bg-[rgba(206,96,135,0.16)]"
              title="Enter"
            >
              <HomeIcon className="w-5 h-5" />
            </button>
          </div>
        </header>
      ) : (
        <header className="fixed top-0 left-0 right-0 z-40 bg-[var(--bg-main)]/90 backdrop-blur-sm border-b border-[var(--border-subtle)]">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            {/* Left: Home Icon */}
            <button
              onClick={() => setActiveTab('dump')}
              className={`p-2 rounded-lg transition-colors ${
                activeTab === 'dump' 
                  ? 'text-[var(--highlight-red)] bg-[rgba(206,96,135,0.18)] border border-[var(--highlight-red)]' 
                  : 'text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]'
              }`}
              title="Text Explorer"
            >
              <HomeIcon className="w-5 h-5" />
            </button>

            {/* Center: App Name */}
            <h1 className="text-lg font-light tracking-tight">
              <span className="text-[var(--text-on-dark)]">enclave</span>
            </h1>

            {/* Right: Help Icon */}
            <button
              onClick={() => setActiveTab('info')}
              className="p-2 rounded-lg transition-colors text-[var(--text-on-dark)] hover:text-[var(--highlight-red)] hover:bg-[rgba(206,96,135,0.16)]"
              title="How It Works"
            >
              <HelpIcon className="w-5 h-5" />
            </button>
          </div>
        </header>
      )}

      {/* Content Area - offset for fixed header */}
      <div className="pt-14">
        {activeTab === 'info' && <InfoTab onNavigate={setActiveTab} />}
        {activeTab === 'dump' && <DumpTab />}
      </div>
    </div>
  );
}

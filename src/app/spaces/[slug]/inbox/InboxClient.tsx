'use client'

import { useState, useMemo } from 'react'

interface Fact {
  id: string
  content: string
  sourceText: string | null
  category: string
  subcategory: string | null
  timeRef: string | null
  dateStr: string | null
  calendarDates: string[] | null
  entities: string[]
  uploadName: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const getGroupKey = (fact: Fact): string => {
  if (!fact.subcategory) return ''
  
  if (fact.dateStr && fact.dateStr.startsWith('recurring:')) {
    return fact.subcategory.toLowerCase()
  } else if (fact.dateStr) {
    return `${fact.subcategory.toLowerCase()}__${fact.dateStr}`
  } else {
    return fact.subcategory.toLowerCase()
  }
}

function renderFactCard(fact: Fact, groupFacts: Fact[], expandedCards: Record<string, boolean>, setExpandedCards: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void) {
  if (!fact.subcategory) return null
  
  const subcategory = fact.subcategory.toLowerCase()
  const isExpanded = expandedCards[subcategory]
  const mainFact = groupFacts?.[0] || fact
  
  let dateChip = null
  
  if (mainFact.dateStr && !mainFact.dateStr.startsWith('recurring:')) {
    try {
      const parts = mainFact.dateStr.split('-')
      if (parts.length === 3) {
        const year = parseInt(parts[0])
        const month = parseInt(parts[1]) - 1
        const day = parseInt(parts[2])
        dateChip = `${MONTHS[month]} ${day}`
      }
    } catch (e) {}
  }
  
  return (
    <div key={fact.id} className="mb-3">
      <button
        onClick={() => {
          setExpandedCards(prev => ({ ...prev, [subcategory]: !isExpanded }))
        }}
        className="w-full text-left bg-[var(--card-bg)] rounded-lg p-4 hover:bg-[var(--card-hover)] transition-colors group"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-on-card-title)] mb-1">
              {mainFact.subcategory}
            </h3>
            <p className="text-xs text-[var(--text-on-card)] opacity-70 leading-relaxed">
              {mainFact.content}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {dateChip && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-on-card)] opacity-60 font-mono">
                {dateChip}
              </span>
            )}
            <svg className="w-4 h-4 text-[var(--text-on-card)] opacity-40 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </button>
      
      {isExpanded && (
        <div className="mt-2 ml-4 pl-4 border-l-2 border-[var(--card-border)] space-y-3">
          {groupFacts.map((f) => (
            <div key={f.id} className="text-xs text-[var(--text-on-card)] opacity-70">
              {f.sourceText && (
                <p className="leading-relaxed mb-2">{f.sourceText}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InboxClient({ facts: initialFacts }: { facts: Fact[] }) {
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    recurring: false,
    facts: false,
    past: false
  })

  const groupedFacts = useMemo(() => {
    const groups: Record<string, Fact[]> = {}
    const ungrouped: Fact[] = []
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]
    
    const todayFacts: Fact[] = []
    const upcomingFacts: Fact[] = []
    const recurringFacts: Fact[] = []
    const staticFacts: Fact[] = []
    const oldFacts: Fact[] = []
    
    for (const fact of initialFacts) {
      if (fact.subcategory) {
        let key: string
        if (fact.dateStr && fact.dateStr.startsWith('recurring:')) {
          key = fact.subcategory.toLowerCase()
        } else if (fact.dateStr) {
          key = `${fact.subcategory.toLowerCase()}__${fact.dateStr}`
        } else {
          key = fact.subcategory.toLowerCase()
        }
        
        if (!groups[key]) groups[key] = []
        groups[key].push(fact)
      } else {
        ungrouped.push(fact)
      }
      
      if (fact.subcategory) {
        let key: string
        if (fact.dateStr && fact.dateStr.startsWith('recurring:')) {
          key = fact.subcategory.toLowerCase()
        } else if (fact.dateStr) {
          key = `${fact.subcategory.toLowerCase()}__${fact.dateStr}`
        } else {
          key = fact.subcategory.toLowerCase()
        }
        
        const isFirstInGroup = groups[key][0] === fact
        
        if (isFirstInGroup) {
          if (fact.dateStr) {
            if (fact.dateStr.startsWith('recurring:')) {
              recurringFacts.push(fact)
            } else if (fact.dateStr.startsWith('week:')) {
              upcomingFacts.push(fact)
            } else {
              const factDate = new Date(fact.dateStr)
              factDate.setHours(0, 0, 0, 0)
              const todayDate = new Date(todayStr)
              todayDate.setHours(0, 0, 0, 0)
              
              if (factDate.getTime() === todayDate.getTime()) {
                todayFacts.push(fact)
              } else if (factDate.getTime() > todayDate.getTime()) {
                upcomingFacts.push(fact)
              } else {
                oldFacts.push(fact)
              }
            }
          } else {
            staticFacts.push(fact)
          }
        }
      } else {
        if (fact.dateStr) {
          if (fact.dateStr.startsWith('recurring:')) {
            recurringFacts.push(fact)
          } else if (fact.dateStr.startsWith('week:')) {
            upcomingFacts.push(fact)
          } else {
            const factDate = new Date(fact.dateStr)
            factDate.setHours(0, 0, 0, 0)
            const todayDate = new Date(todayStr)
            todayDate.setHours(0, 0, 0, 0)
            
            if (factDate.getTime() === todayDate.getTime()) {
              todayFacts.push(fact)
            } else if (factDate.getTime() > todayDate.getTime()) {
              upcomingFacts.push(fact)
            } else {
              oldFacts.push(fact)
            }
          }
        } else {
          staticFacts.push(fact)
        }
      }
    }
    
    upcomingFacts.sort((a, b) => {
      if (!a.dateStr || !b.dateStr) return 0
      return a.dateStr.localeCompare(b.dateStr)
    })
    
    oldFacts.sort((a, b) => {
      if (!a.dateStr || !b.dateStr) return 0
      return b.dateStr.localeCompare(a.dateStr)
    })
    
    const weekdayOrder: Record<string, number> = {
      'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
      'friday': 5, 'saturday': 6, 'sunday': 7
    }
    recurringFacts.sort((a, b) => {
      const aDay = (a.dateStr || '').toLowerCase()
      const bDay = (b.dateStr || '').toLowerCase()
      let aOrder = 8, bOrder = 8
      for (const [day, order] of Object.entries(weekdayOrder)) {
        if (aDay.includes(day)) aOrder = order
        if (bDay.includes(day)) bOrder = order
      }
      return aOrder - bOrder
    })
    
    return { 
      groups, 
      ungrouped,
      todayFacts,
      upcomingFacts,
      recurringFacts,
      staticFacts,
      oldFacts
    }
  }, [initialFacts])

  const toggleCategoryCollapse = (category: 'recurring' | 'facts' | 'past') => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }))
  }

  if (initialFacts.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-[var(--text-meta)]">no facts yet</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
      {/* LEFT COLUMN */}
      <div className="space-y-8">
        {/* Upcoming Section */}
        {(groupedFacts.todayFacts.length > 0 || groupedFacts.upcomingFacts.length > 0) && (
          <div>
            <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] mb-4 font-mono">
              UPCOMING
            </h4>
            <div className="space-y-1">
              {groupedFacts.todayFacts.map(fact => {
                const groupKey = getGroupKey(fact)
                const groupFacts = groupedFacts.groups[groupKey] || [fact]
                return renderFactCard(fact, groupFacts, expandedCards, setExpandedCards)
              })}
              {groupedFacts.upcomingFacts.map(fact => {
                const groupKey = getGroupKey(fact)
                const groupFacts = groupedFacts.groups[groupKey] || [fact]
                return renderFactCard(fact, groupFacts, expandedCards, setExpandedCards)
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* RIGHT COLUMN */}
      <div className="space-y-8">
        {/* Recurring Section */}
        {groupedFacts.recurringFacts.length > 0 && (
          <div>
            <button
              onClick={() => toggleCategoryCollapse('recurring')}
              className="flex items-center gap-2 mb-4 group"
            >
              <svg className={`w-3 h-3 text-[var(--text-meta)] transition-transform ${collapsedCategories.recurring ? 'rotate-0' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono">
                RECURRING
              </h4>
            </button>
            
            {!collapsedCategories.recurring && (
              <div className="space-y-1">
                {groupedFacts.recurringFacts.map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return renderFactCard(fact, groupFacts, expandedCards, setExpandedCards)
                })}
              </div>
            )}
          </div>
        )}
        
        {/* Facts Section */}
        {groupedFacts.staticFacts.length > 0 && (
          <div>
            <button
              onClick={() => toggleCategoryCollapse('facts')}
              className="flex items-center gap-2 mb-4 group"
            >
              <svg className={`w-3 h-3 text-[var(--text-meta)] transition-transform ${collapsedCategories.facts ? 'rotate-0' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono">
                FACTS
              </h4>
            </button>
            
            {!collapsedCategories.facts ? (
              <div className="space-y-1">
                {groupedFacts.staticFacts.slice(0, 5).map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return renderFactCard(fact, groupFacts, expandedCards, setExpandedCards)
                })}
                {groupedFacts.staticFacts.length > 5 && (
                  <p className="text-xs text-[var(--text-meta)] mt-2 font-mono">
                    +{groupedFacts.staticFacts.length - 5} more
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {groupedFacts.staticFacts.slice(0, 3).map(fact => (
                  <p key={fact.id} className="text-xs text-[var(--text-meta)] font-mono">
                    {fact.subcategory || 'Fact'}
                  </p>
                ))}
                {groupedFacts.staticFacts.length > 3 && (
                  <p className="text-xs text-[var(--text-meta)] mt-2 font-mono">
                    +{groupedFacts.staticFacts.length - 3} more
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Past Section */}
        {groupedFacts.oldFacts.length > 0 && (
          <div>
            <button
              onClick={() => toggleCategoryCollapse('past')}
              className="flex items-center gap-2 mb-4 group"
            >
              <svg className={`w-3 h-3 text-[var(--text-meta)] transition-transform ${collapsedCategories.past ? 'rotate-0' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono">
                PAST
              </h4>
            </button>
            
            {!collapsedCategories.past ? (
              <div className="space-y-1">
                {groupedFacts.oldFacts.slice(0, 5).map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return renderFactCard(fact, groupFacts, expandedCards, setExpandedCards)
                })}
                {groupedFacts.oldFacts.length > 5 && (
                  <p className="text-xs text-[var(--text-meta)] mt-2 font-mono">
                    +{groupedFacts.oldFacts.length - 5} more
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {groupedFacts.oldFacts.slice(0, 3).map(fact => (
                  <p key={fact.id} className="text-xs text-[var(--text-meta)] font-mono">
                    {fact.subcategory || 'Event'}
                  </p>
                ))}
                {groupedFacts.oldFacts.length > 3 && (
                  <p className="text-xs text-[var(--text-meta)] mt-2 font-mono">
                    +{groupedFacts.oldFacts.length - 3} more
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

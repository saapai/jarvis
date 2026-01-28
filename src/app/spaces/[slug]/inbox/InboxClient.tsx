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

const CARD_BG = 'bg-[var(--card-bg)] rounded-lg'
const CARD_CLASS = 'card transition-all'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const getColumnCardStyle = (columnType: 'left' | 'right') => {
  if (columnType === 'left') {
    return {
      background: `linear-gradient(rgba(185, 135, 152, 0.18), rgba(185, 135, 152, 0.18)), var(--card-bg)`,
      borderColor: '#d7b7b2',
      borderWidth: '1.5px',
      borderStyle: 'solid',
    }
  } else {
    return {
      background: `linear-gradient(rgba(105, 135, 148, 0.18), rgba(105, 135, 148, 0.18)), var(--card-bg)`,
      borderColor: '#9fb5b8',
      borderWidth: '1.5px',
      borderStyle: 'solid',
    }
  }
}

const getUrgencyBucket = (dateStr: string | null, isPast: boolean): 'critical' | 'high' | 'medium' | 'low' | 'minimal' => {
  if (!dateStr || dateStr.startsWith('recurring:')) return 'minimal'
  
  try {
    const parts = dateStr.split('-')
    if (parts.length !== 3) return 'minimal'
    
    const eventDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    eventDate.setHours(0, 0, 0, 0)
    
    const diffTime = eventDate.getTime() - today.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    
    if (isPast) {
      const daysSince = -diffDays
      if (daysSince === 1) return 'high'
      if (daysSince <= 3) return 'medium'
      if (daysSince <= 7) return 'low'
      return 'minimal'
    } else {
      if (diffDays === 0) return 'critical'
      if (diffDays >= 1 && diffDays <= 3) return 'high'
      if (diffDays >= 4 && diffDays <= 7) return 'medium'
      if (diffDays >= 8 && diffDays <= 14) return 'low'
      return 'minimal'
    }
  } catch (e) {
    return 'minimal'
  }
}

const getDateChipClasses = (urgency: 'critical' | 'high' | 'medium' | 'low' | 'minimal'): string => {
  const baseClasses = 'text-[10px] px-1.5 py-0.5 rounded border font-mono'
  
  switch (urgency) {
    case 'critical':
      return `${baseClasses} text-[#ce6087] border-[#ce6087] bg-[rgba(206,96,135,0.25)]`
    case 'high':
      return `${baseClasses} text-[var(--text-meta)] border-[rgba(206,96,135,0.4)] bg-[rgba(206,96,135,0.12)]`
    case 'medium':
      return `${baseClasses} text-[var(--text-meta)] border-[rgba(206,96,135,0.25)] bg-[rgba(206,96,135,0.08)]`
    case 'low':
      return `${baseClasses} text-[var(--text-meta)] border-[var(--text-meta)]/15 bg-[var(--text-meta)]/5`
    case 'minimal':
    default:
      return `${baseClasses} text-[var(--text-meta)] border-[var(--text-meta)]/20 bg-[var(--text-meta)]/3`
  }
}

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

function FactCard({ 
  fact, 
  groupFacts, 
  columnType, 
  isPastEvent, 
  expandedCards, 
  setExpandedCards,
  isAdmin,
  spaceSlug,
  onUpdate,
  onDelete
}: {
  fact: Fact
  groupFacts: Fact[]
  columnType: 'left' | 'right'
  isPastEvent: boolean
  expandedCards: Record<string, boolean>
  setExpandedCards: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  isAdmin: boolean
  spaceSlug: string
  onUpdate: (factId: string, updates: { subcategory?: string | null; content?: string }) => Promise<void>
  onDelete: (factId: string) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingField, setEditingField] = useState<'title' | 'content' | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  if (!fact.subcategory) return null
  
  const subcategory = fact.subcategory.toLowerCase()
  const isExpanded = expandedCards[subcategory]
  const mainFact = groupFacts?.[0] || fact
  
  let dateChip = null
  let urgency: 'critical' | 'high' | 'medium' | 'low' | 'minimal' = 'minimal'
  
  if (mainFact.dateStr && !mainFact.dateStr.startsWith('recurring:')) {
    try {
      const parts = mainFact.dateStr.split('-')
      if (parts.length === 3) {
        const year = parseInt(parts[0])
        const month = parseInt(parts[1]) - 1
        const day = parseInt(parts[2])
        dateChip = `${MONTHS[month]} ${day}`
        urgency = getUrgencyBucket(mainFact.dateStr, isPastEvent)
      }
    } catch (e) {}
  } else if (mainFact.dateStr && mainFact.dateStr.startsWith('recurring:')) {
    const day = mainFact.dateStr.replace('recurring:', '')
    dateChip = day.charAt(0).toUpperCase() + day.slice(1, 3)
    urgency = 'minimal'
  }
  
  const dateChipClasses = getDateChipClasses(urgency)

  const handleDoubleClick = (field: 'title' | 'content') => {
    if (!isAdmin) return
    setEditingField(field)
    if (field === 'title') {
      setEditTitle(mainFact.subcategory || '')
    } else {
      setEditContent(mainFact.content)
    }
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!editingField) return
    setIsSaving(true)
    try {
      const updates: { subcategory?: string | null; content?: string } = {}
      if (editingField === 'title') {
        updates.subcategory = editTitle.trim() || null
      } else {
        updates.content = editContent.trim()
      }
      await onUpdate(mainFact.id, updates)
      setIsEditing(false)
      setEditingField(null)
    } catch (error) {
      console.error('Error saving:', error)
      alert('Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditingField(null)
    setEditTitle('')
    setEditContent('')
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this card?')) return
    setIsDeleting(true)
    try {
      await onDelete(mainFact.id)
    } catch (error) {
      console.error('Error deleting:', error)
      alert('Failed to delete card')
      setIsDeleting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }
  
  return (
    <div key={fact.id} className="animate-slide-in">
      <div 
        className={`
          group/card w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} overflow-hidden 
          shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] 
          hover:border-[var(--highlight-red)]/40 
          hover:-translate-y-[1px] 
          hover:shadow-[inset_0_1px_0_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]
          transition-all duration-[120ms] ease-out relative
        `}
        style={getColumnCardStyle(columnType)}
      >
        {isAdmin && !isEditing && (
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded hover:bg-[rgba(206,96,135,0.2)] transition-colors z-10 opacity-0 group-hover/card:opacity-100"
            title="Delete card"
          >
            <svg className="w-4 h-4 text-[var(--highlight-red)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        
        <div className="w-full p-4 relative">
          <button
            onClick={() => {
              if (!isEditing) {
                setExpandedCards(prev => ({ ...prev, [subcategory]: !isExpanded }))
              }
            }}
            onDoubleClick={() => handleDoubleClick('title')}
            className="w-full text-left transition-colors"
            disabled={isEditing}
          >
            <div className="flex items-baseline justify-between gap-4 mb-2">
              {isEditing && editingField === 'title' ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSave}
                  autoFocus
                  className="flex-1 text-base font-semibold text-[var(--bg-main)] leading-tight bg-transparent border-b-2 border-[var(--highlight-red)]/50 focus:outline-none focus:border-[var(--highlight-red)]"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <h3 className="text-base font-semibold text-[var(--bg-main)] leading-tight flex-1">
                  {mainFact.subcategory}
                </h3>
              )}
              
              <div className="flex items-baseline gap-2">
                {dateChip && (
                  <span className={dateChipClasses}>
                    {dateChip}
                  </span>
                )}
                {!isEditing && (
                  <span className="text-[var(--text-meta)] text-sm">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                )}
                {isEditing && editingField === 'title' && (
                  <span className="text-xs text-[var(--text-meta)]">⌘+Enter to save</span>
                )}
              </div>
            </div>
            
            {isEditing && editingField === 'content' ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                autoFocus
                rows={3}
                className="w-full text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed bg-transparent border-b-2 border-[var(--highlight-red)]/50 focus:outline-none focus:border-[var(--highlight-red)] resize-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p 
                onDoubleClick={() => handleDoubleClick('content')}
                className="text-sm text-[var(--text-on-card)] opacity-60 font-light leading-relaxed"
              >
                {mainFact.content}
              </p>
            )}
          </button>
        </div>
        
        {isExpanded && (
          <div className="border-t border-[var(--card-border)] p-4 space-y-4 animate-slide-in">
            {groupFacts.map((f) => (
              <div key={f.id} className="text-sm">
                {f.sourceText && (
                  <p className="text-[var(--text-on-card)] leading-relaxed mb-3 font-light">
                    {f.sourceText}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {f.entities.slice(0, 8).map((entity) => (
                    <span
                      key={entity}
                      className="text-xs font-mono text-[var(--highlight-blue)]"
                    >
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InboxClient({ facts: initialFacts, isAdmin, spaceSlug }: { facts: Fact[]; isAdmin: boolean; spaceSlug: string }) {
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    recurring: true,
    facts: true,
    past: true
  })
  const [facts, setFacts] = useState<Fact[]>(initialFacts)

  const handleUpdateFact = async (factId: string, updates: { subcategory?: string | null; content?: string }) => {
    const fact = facts.find(f => f.id === factId)
    if (!fact) return

    // If updating subcategory, update all facts in the group
    if (updates.subcategory !== undefined) {
      const groupKey = getGroupKey(fact)
      const factIdsToUpdate = facts
        .filter(f => getGroupKey(f) === groupKey)
        .map(f => f.id)

      // Update all facts in the group
      await Promise.all(
        factIdsToUpdate.map(async (id) => {
          const response = await fetch(`/api/spaces/${spaceSlug}/facts/${id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ subcategory: updates.subcategory }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to update fact')
          }
        })
      )

      // Update local state for all facts in the group
      setFacts(prev => prev.map(f => {
        if (factIdsToUpdate.includes(f.id)) {
          return { ...f, subcategory: updates.subcategory || null }
        }
        return f
      }))
    } else {
      // If updating content, only update the main fact
      const response = await fetch(`/api/spaces/${spaceSlug}/facts/${factId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update fact')
      }

      // Update local state
      setFacts(prev => prev.map(f => {
        if (f.id === factId) {
          return { ...f, ...updates }
        }
        return f
      }))
    }
  }

  const handleDeleteFact = async (factId: string) => {
    // Find the fact and its group
    const fact = facts.find(f => f.id === factId)
    if (!fact) return

    const groupKey = getGroupKey(fact)
    
    // Find all facts in the same group
    const factIdsToDelete = facts
      .filter(f => getGroupKey(f) === groupKey)
      .map(f => f.id)

    // Delete all facts in the group
    await Promise.all(
      factIdsToDelete.map(async (id) => {
        const response = await fetch(`/api/spaces/${spaceSlug}/facts/${id}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to delete fact')
        }
      })
    )

    // Remove from local state
    setFacts(prev => prev.filter(f => !factIdsToDelete.includes(f.id)))
  }

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
    
    for (const fact of facts) {
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
        
        const isFirstInGroup = groups[key] && groups[key][0] === fact
        
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
  }, [facts])

  const toggleCategoryCollapse = (category: 'recurring' | 'facts' | 'past') => {
    setCollapsedCategories(prev => ({ ...prev, [category]: !prev[category] }))
    
    // Expand all cards in the category when category is expanded
    if (collapsedCategories[category]) {
      const categoryFacts = category === 'recurring' 
        ? groupedFacts.recurringFacts 
        : category === 'facts' 
        ? groupedFacts.staticFacts 
        : groupedFacts.oldFacts
      
      const newExpanded: Record<string, boolean> = {}
      categoryFacts.forEach(fact => {
        if (fact.subcategory) {
          newExpanded[fact.subcategory.toLowerCase()] = true
        }
      })
      setExpandedCards(prev => ({ ...prev, ...newExpanded }))
    }
  }

  if (facts.length === 0) {
    return (
      <div className="text-center py-12 bg-[var(--card-bg)] rounded-lg shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] border border-[var(--card-border)]">
        <svg
          className="mx-auto h-12 w-12 text-[var(--text-meta)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-[var(--text-on-card-title)]">No facts yet</h3>
        <p className="mt-1 text-sm text-[var(--text-meta)]">
          Upload documents to extract facts and build your knowledge base.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* LEFT COLUMN: THE LIVING TIMELINE */}
      <div className="space-y-6">
        {/* Today Section */}
        {groupedFacts.todayFacts.length > 0 && (
          <div>
            <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] mb-3 font-mono">Today</h4>
            <div className="space-y-3">
              {groupedFacts.todayFacts.map(fact => {
                const groupKey = getGroupKey(fact)
                const groupFacts = groupedFacts.groups[groupKey] || [fact]
                return (
                  <FactCard
                    key={fact.id}
                    fact={fact}
                    groupFacts={groupFacts}
                    columnType="left"
                    isPastEvent={false}
                    expandedCards={expandedCards}
                    setExpandedCards={setExpandedCards}
                    isAdmin={isAdmin}
                    spaceSlug={spaceSlug}
                    onUpdate={handleUpdateFact}
                    onDelete={handleDeleteFact}
                  />
                )
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
                const groupKey = getGroupKey(fact)
                const groupFacts = groupedFacts.groups[groupKey] || [fact]
                return (
                  <FactCard
                    key={fact.id}
                    fact={fact}
                    groupFacts={groupFacts}
                    columnType="left"
                    isPastEvent={false}
                    expandedCards={expandedCards}
                    setExpandedCards={setExpandedCards}
                    isAdmin={isAdmin}
                    spaceSlug={spaceSlug}
                    onUpdate={handleUpdateFact}
                    onDelete={handleDeleteFact}
                  />
                )
              })}
            </div>
          </div>
        )}
        
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
            
            {collapsedCategories.recurring ? (
              <div
                className="relative pb-6 cursor-pointer"
                onClick={() => toggleCategoryCollapse('recurring')}
              >
                <div className="relative overflow-visible">
                  <div
                    className={`absolute inset-0 translate-y-4 scale-[0.97] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.35,
                      zIndex: 1,
                    }}
                  />
                  <div
                    className={`absolute inset-0 translate-y-2 scale-[0.985] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.6,
                      zIndex: 2,
                    }}
                  />
                  <div
                    className={`relative w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] rounded-lg`}
                    style={{
                      ...getColumnCardStyle('right'),
                      zIndex: 3,
                    }}
                  >
                    <div className="px-4 py-4">
                      <div className="text-sm font-semibold text-[var(--bg-main)] leading-tight space-y-1">
                        {groupedFacts.recurringFacts.slice(0, 3).map((fact, i) => (
                          <div key={i}>{fact.subcategory}</div>
                        ))}
                        {groupedFacts.recurringFacts.length > 3 && (
                          <div className="text-xs opacity-60">+{groupedFacts.recurringFacts.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {groupedFacts.recurringFacts.map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return (
                    <FactCard
                      key={fact.id}
                      fact={fact}
                      groupFacts={groupFacts}
                      columnType="right"
                      isPastEvent={false}
                      expandedCards={expandedCards}
                      setExpandedCards={setExpandedCards}
                      isAdmin={isAdmin}
                      spaceSlug={spaceSlug}
                      onUpdate={handleUpdateFact}
                      onDelete={handleDeleteFact}
                    />
                  )
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
              className="w-full flex items-center gap-2 mb-3 group"
            >
              <span className="text-[var(--text-meta)] text-sm group-hover:text-[var(--text-on-dark)] transition-colors">
                {collapsedCategories.facts ? '▸' : '▾'}
              </span>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-meta)] font-mono group-hover:text-[var(--text-on-dark)] transition-colors">
                Facts
              </h4>
            </button>
            
            {collapsedCategories.facts ? (
              <div
                className="relative pb-6 cursor-pointer"
                onClick={() => toggleCategoryCollapse('facts')}
              >
                <div className="relative overflow-visible">
                  <div
                    className={`absolute inset-0 translate-y-4 scale-[0.97] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.35,
                      zIndex: 1,
                    }}
                  />
                  <div
                    className={`absolute inset-0 translate-y-2 scale-[0.985] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.6,
                      zIndex: 2,
                    }}
                  />
                  <div
                    className={`relative w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] rounded-lg`}
                    style={{
                      ...getColumnCardStyle('right'),
                      zIndex: 3,
                    }}
                  >
                    <div className="px-4 py-4">
                      <div className="text-sm font-semibold text-[var(--bg-main)] leading-tight space-y-1">
                        {groupedFacts.staticFacts.slice(0, 3).map((fact, i) => (
                          <div key={i}>{fact.subcategory || 'Fact'}</div>
                        ))}
                        {groupedFacts.staticFacts.length > 3 && (
                          <div className="text-xs opacity-60">+{groupedFacts.staticFacts.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {groupedFacts.staticFacts.map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return (
                    <FactCard
                      key={fact.id}
                      fact={fact}
                      groupFacts={groupFacts}
                      columnType="right"
                      isPastEvent={false}
                      expandedCards={expandedCards}
                      setExpandedCards={setExpandedCards}
                      isAdmin={isAdmin}
                      spaceSlug={spaceSlug}
                      onUpdate={handleUpdateFact}
                      onDelete={handleDeleteFact}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )}
        
        {/* Past Section */}
        {groupedFacts.oldFacts.length > 0 && (
          <div>
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
            
            {collapsedCategories.past ? (
              <div
                className="relative pb-6 cursor-pointer"
                onClick={() => toggleCategoryCollapse('past')}
              >
                <div className="relative overflow-visible">
                  <div
                    className={`absolute inset-0 translate-y-4 scale-[0.97] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.35,
                      zIndex: 1,
                    }}
                  />
                  <div
                    className={`absolute inset-0 translate-y-2 scale-[0.985] rounded-lg ${CARD_BG} border border-[var(--card-border)] shadow-[inset_0_1px_0_rgba(0,0,0,0.15)]`}
                    style={{
                      ...getColumnCardStyle('right'),
                      opacity: 0.6,
                      zIndex: 2,
                    }}
                  />
                  <div
                    className={`relative w-full ${CARD_BG} border border-[var(--card-border)] ${CARD_CLASS} shadow-[inset_0_1px_0_rgba(0,0,0,0.15)] rounded-lg`}
                    style={{
                      ...getColumnCardStyle('right'),
                      zIndex: 3,
                    }}
                  >
                    <div className="px-4 py-4">
                      <div className="text-sm font-semibold text-[var(--bg-main)] leading-tight space-y-1">
                        {groupedFacts.oldFacts.slice(0, 3).map((fact, i) => (
                          <div key={i}>{fact.subcategory || 'Event'}</div>
                        ))}
                        {groupedFacts.oldFacts.length > 3 && (
                          <div className="text-xs opacity-60">+{groupedFacts.oldFacts.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {groupedFacts.oldFacts.map(fact => {
                  const groupKey = getGroupKey(fact)
                  const groupFacts = groupedFacts.groups[groupKey] || [fact]
                  return (
                    <FactCard
                      key={fact.id}
                      fact={fact}
                      groupFacts={groupFacts}
                      columnType="right"
                      isPastEvent={true}
                      expandedCards={expandedCards}
                      setExpandedCards={setExpandedCards}
                      isAdmin={isAdmin}
                      spaceSlug={spaceSlug}
                      onUpdate={handleUpdateFact}
                      onDelete={handleDeleteFact}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

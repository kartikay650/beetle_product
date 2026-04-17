'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import TagInput from '@/components/ui/tag-input'
import { track } from '@/lib/analytics'
import { createClient } from '@/lib/supabase/client'

const STORAGE_KEY = 'beetle_onboarding_v1'

const STEP_NAMES = ['Your product', 'Your customer', 'Reply tone', 'Keywords', 'Subreddits'] as const

const SUGGESTED_SUBREDDITS = ['entrepreneur', 'marketing', 'webdev', 'smallbusiness', 'growmybusiness']

const DEFAULT_SUBREDDITS = ['saas', 'startups', 'indiehackers']

type WizardData = {
  product_name: string
  product_description: string
  icp_description: string
  tone_guide: string
  keywords: string[]
  competitors: string[]
  subreddits: string[]
}

const emptyData: WizardData = {
  product_name: '',
  product_description: '',
  icp_description: '',
  tone_guide: '',
  keywords: [],
  competitors: [],
  subreddits: DEFAULT_SUBREDDITS,
}

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(emptyData)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load persisted state
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)

      // If onboarding already complete, bounce to dashboard
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.onboarding_complete) {
        router.push('/dashboard')
        return
      }

      // Check localStorage first
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.step) setStep(parsed.step)
          if (parsed.data) setData((prev) => ({ ...prev, ...parsed.data }))
        } catch {
          // ignore corrupt data
        }
        setLoaded(true)
        return
      }

      // Check for existing workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (workspace && workspace.product_name) {
        setData((prev) => ({
          ...prev,
          product_name: workspace.product_name || '',
          product_description: workspace.product_description || '',
          icp_description: workspace.icp_description || '',
          tone_guide: workspace.tone_guide || '',
          keywords: workspace.keywords || [],
          competitors: workspace.competitors || [],
          subreddits: workspace.subreddits?.length ? workspace.subreddits : DEFAULT_SUBREDDITS,
        }))
      }

      setLoaded(true)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback((currentStep: number, currentData: WizardData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, data: currentData }))
  }, [])

  const saveToSupabase = useCallback(async (partial: Partial<WizardData>) => {
    if (!userId) return
    await supabase
      .from('workspaces')
      .upsert({ user_id: userId, ...partial }, { onConflict: 'user_id' })
  }, [userId, supabase])

  function updateField<K extends keyof WizardData>(field: K, value: WizardData[K]) {
    setData((prev) => ({ ...prev, [field]: value }))
    // Clear error for this field
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function validateStep(): boolean {
    const errs: Record<string, string> = {}

    switch (step) {
      case 1:
        if (!data.product_name.trim()) errs.product_name = 'Product name is required'
        if (!data.product_description.trim()) errs.product_description = 'Description is required'
        if (data.product_description.length > 200) errs.product_description = 'Must be 200 characters or fewer'
        break
      case 2:
        if (!data.icp_description.trim()) errs.icp_description = 'Customer description is required'
        if (data.icp_description.length > 200) errs.icp_description = 'Must be 200 characters or fewer'
        break
      case 3:
        if (!data.tone_guide.trim()) errs.tone_guide = 'Tone guide is required'
        if (data.tone_guide.length > 150) errs.tone_guide = 'Must be 150 characters or fewer'
        break
      case 4:
        if (data.keywords.length === 0) errs.keywords = 'Add at least one keyword'
        break
      case 5:
        if (data.subreddits.length === 0) errs.subreddits = 'Add at least one subreddit'
        break
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleNext() {
    if (!validateStep()) return

    const nextStep = step + 1
    persist(nextStep, data)
    await saveToSupabase(data)
    setStep(nextStep)
  }

  function handleBack() {
    const prevStep = step - 1
    persist(prevStep, data)
    setStep(prevStep)
  }

  async function handleSubmit() {
    if (!validateStep()) return
    if (!userId) return

    setSubmitting(true)

    try {
      await saveToSupabase(data)

      await supabase
        .from('profiles')
        .update({ onboarding_complete: true })
        .eq('id', userId)

      track('onboarding_completed', {
        keywords_count: data.keywords.length,
        subreddits_count: data.subreddits.length,
        has_competitors: data.competitors.length > 0,
      })

      localStorage.removeItem(STORAGE_KEY)
      router.push('/dashboard')
    } catch {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-beetle-bg flex items-center justify-center">
        <p className="text-beetle-muted text-sm font-body">Loading…</p>
      </div>
    )
  }

  const progressPercent = (step / 5) * 100

  return (
    <div className="min-h-screen bg-beetle-bg flex flex-col items-center py-12 px-4">
      {/* Progress bar */}
      <div className="w-full max-w-lg">
        <div className="h-0.5 bg-beetle-border rounded-full overflow-hidden">
          <div
            className="h-full bg-beetle-orange transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="text-xs text-beetle-muted font-body mt-2">
          Step {step} of 5 · {STEP_NAMES[step - 1]}
        </p>
      </div>

      {/* Step card */}
      <div className="bg-white border border-beetle-border rounded-2xl shadow-sm w-full max-w-lg p-8 mt-4">
        {step === 1 && <Step1 data={data} errors={errors} updateField={updateField} />}
        {step === 2 && <Step2 data={data} errors={errors} updateField={updateField} />}
        {step === 3 && <Step3 data={data} errors={errors} updateField={updateField} />}
        {step === 4 && <Step4 data={data} errors={errors} updateField={updateField} />}
        {step === 5 && <Step5 data={data} errors={errors} updateField={updateField} />}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          {step > 1 ? (
            <button
              onClick={handleBack}
              className="text-beetle-muted font-body text-sm hover:text-beetle-ink transition-colors"
            >
              ← Back
            </button>
          ) : (
            <div />
          )}

          {step < 5 ? (
            <button
              onClick={handleNext}
              className="bg-beetle-orange text-white font-body font-medium px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-beetle-orange text-white font-body font-medium px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Setting up…
                </span>
              ) : (
                'Find my first Reddit threads →'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Step Components ─── */

interface StepProps {
  data: WizardData
  errors: Record<string, string>
  updateField: <K extends keyof WizardData>(field: K, value: WizardData[K]) => void
}

function CharCount({ current, max }: { current: number; max: number }) {
  return (
    <p className={`text-right text-xs font-body mt-1 ${current > max - 20 ? 'text-red-500' : 'text-beetle-muted'}`}>
      {current} / {max}
    </p>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-red-600 text-sm font-body mt-1">{message}</p>
}

function Step1({ data, errors, updateField }: StepProps) {
  return (
    <>
      <h2 className="font-display font-bold text-xl text-beetle-ink mb-1">What do you build?</h2>
      <p className="font-body text-sm text-beetle-muted mb-6 leading-relaxed">
        beetle uses this to make every reply sound like it comes from someone who genuinely knows the product.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block font-body text-sm text-beetle-ink mb-1.5">Product name</label>
          <input
            type="text"
            value={data.product_name}
            onChange={(e) => updateField('product_name', e.target.value)}
            placeholder="e.g. Loom, Linear, Notion"
            className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent"
          />
          <FieldError message={errors.product_name} />
        </div>

        <div>
          <label className="block font-body text-sm text-beetle-ink mb-1.5">What does it do?</label>
          <textarea
            value={data.product_description}
            onChange={(e) => updateField('product_description', e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="e.g. beetle monitors Reddit for high-intent threads and drafts replies your team posts manually — no bots, no automation."
            className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
          />
          <CharCount current={data.product_description.length} max={200} />
          <FieldError message={errors.product_description} />
        </div>
      </div>
    </>
  )
}

function Step2({ data, errors, updateField }: StepProps) {
  return (
    <>
      <h2 className="font-display font-bold text-xl text-beetle-ink mb-1">Who are you selling to?</h2>
      <p className="font-body text-sm text-beetle-muted mb-6 leading-relaxed">
        beetle filters out threads that aren&apos;t relevant to your buyers.
      </p>

      <div>
        <label className="block font-body text-sm text-beetle-ink mb-1.5">Describe your ideal customer</label>
        <textarea
          value={data.icp_description}
          onChange={(e) => updateField('icp_description', e.target.value)}
          maxLength={200}
          rows={4}
          placeholder="e.g. Founder-led B2B SaaS teams with 1–10 people in marketing, selling to technical buyers who research tools on Reddit."
          className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
        />
        <CharCount current={data.icp_description.length} max={200} />
        <FieldError message={errors.icp_description} />
      </div>
    </>
  )
}

function Step3({ data, errors, updateField }: StepProps) {
  return (
    <>
      <h2 className="font-display font-bold text-xl text-beetle-ink mb-1">How should your replies sound?</h2>
      <p className="font-body text-sm text-beetle-muted mb-6 leading-relaxed">
        beetle will match this voice in every draft. You can always edit before posting.
      </p>

      <div>
        <label className="block font-body text-sm text-beetle-ink mb-1.5">Describe your tone</label>
        <textarea
          value={data.tone_guide}
          onChange={(e) => updateField('tone_guide', e.target.value)}
          maxLength={150}
          rows={3}
          placeholder="e.g. Helpful and direct. Never salesy. Sound like a founder who genuinely wants to help, not a marketer trying to convert."
          className="w-full rounded-lg border border-beetle-border bg-white px-3 py-2.5 text-sm text-beetle-ink font-body placeholder:text-beetle-faint focus:outline-none focus:ring-2 focus:ring-beetle-orange focus:border-transparent resize-none"
        />
        <CharCount current={data.tone_guide.length} max={150} />
        <FieldError message={errors.tone_guide} />
      </div>
    </>
  )
}

function Step4({ data, errors, updateField }: StepProps) {
  return (
    <>
      <h2 className="font-display font-bold text-xl text-beetle-ink mb-1">What should beetle track?</h2>
      <p className="font-body text-sm text-beetle-muted mb-6 leading-relaxed">
        Keywords drive your thread feed. Competitors help beetle flag threads where someone is comparing tools.
      </p>

      <div className="space-y-5">
        <div>
          <label className="block font-body text-sm text-beetle-ink mb-1.5">Keywords to monitor</label>
          <TagInput
            value={data.keywords}
            onChange={(tags) => updateField('keywords', tags)}
            placeholder="Type a keyword and press Enter"
          />
          <p className="font-body text-xs text-beetle-faint mt-1.5">
            Press Enter or comma to add. e.g. reddit monitoring, founder gtm
          </p>
          <FieldError message={errors.keywords} />
        </div>

        <div>
          <label className="block font-body text-sm text-beetle-ink mb-1.5">Competitors (optional)</label>
          <TagInput
            value={data.competitors}
            onChange={(tags) => updateField('competitors', tags)}
            placeholder="Type a competitor name and press Enter"
          />
          <p className="font-body text-xs text-beetle-faint mt-1.5">
            Tools your buyers compare you against
          </p>
        </div>
      </div>

      {/* Example preview */}
      <div className="mt-6 p-4 bg-white border border-beetle-border rounded-xl">
        <span className="inline-flex items-center bg-amber-50 text-amber-700 text-[10px] font-medium px-2 py-0.5 rounded-md mb-3">
          example — your real replies use your actual product context
        </span>
        <p className="text-xs text-beetle-muted font-body">
          r/SaaS · Any good tools for tracking Reddit mentions for GTM?
        </p>
        <p className="text-sm text-beetle-ink font-body leading-relaxed mt-1">
          We ran into the same gap last year. Happy to share what worked for us if useful.
        </p>
        <p className="text-[10px] text-beetle-faint mt-2">
          Your actual replies are generated from your product context + KB.
        </p>
      </div>
    </>
  )
}

function Step5({ data, errors, updateField }: StepProps) {
  function addSuggestion(sub: string) {
    if (!data.subreddits.some((s) => s.toLowerCase() === sub.toLowerCase())) {
      updateField('subreddits', [...data.subreddits, sub])
    }
  }

  return (
    <>
      <h2 className="font-display font-bold text-xl text-beetle-ink mb-1">Which communities should beetle watch?</h2>
      <p className="font-body text-sm text-beetle-muted mb-6 leading-relaxed">
        Type subreddit names without r/. beetle scans these for threads matching your keywords.
      </p>

      <div>
        <label className="block font-body text-sm text-beetle-ink mb-1.5">Subreddits to monitor</label>
        <TagInput
          value={data.subreddits}
          onChange={(tags) => updateField('subreddits', tags)}
          placeholder="Type a subreddit and press Enter"
        />
        <p className="font-body text-xs text-beetle-faint mt-1.5">
          Press Enter to add. r/ prefix is stripped automatically.
        </p>
        <FieldError message={errors.subreddits} />
      </div>

      {/* Suggestion chips */}
      <div className="mt-4">
        <p className="text-xs text-beetle-faint font-body mb-2">Suggested communities</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_SUBREDDITS.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => addSuggestion(sub)}
              className="inline-flex items-center px-3 py-1 rounded-full text-xs font-body border border-beetle-border text-beetle-muted bg-white hover:bg-beetle-bg hover:text-beetle-ink cursor-pointer transition-colors"
            >
              {sub}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

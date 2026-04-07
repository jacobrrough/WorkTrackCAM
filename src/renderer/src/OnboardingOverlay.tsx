/**
 * OnboardingOverlay -- First-run quick start guide.
 *
 * Displayed on initial launch (controlled by a localStorage flag).
 * Walks the user through 4 steps: select machine, import model,
 * create operation, generate G-code. Includes a "Don't show again"
 * checkbox and dismisses to the normal app.
 */
import React, { useState } from 'react'

const ONBOARDING_DISMISSED_KEY = 'fab-onboarding-dismissed-v1'

/** Check whether the onboarding should be shown. */
export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true'
  } catch {
    return false
  }
}

/** Mark onboarding as dismissed permanently. */
function dismissOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true')
  } catch { /* storage unavailable -- ignore */ }
}

// ── Steps ────────────────────────────────────────────────────────────────────

interface OnboardingStep {
  number: number
  title: string
  description: string
  icon: string
}

const STEPS: OnboardingStep[] = [
  {
    number: 1,
    title: 'Select your machine',
    description: 'Choose a CNC mill, router, or 3D printer from the machine library. This configures available operations, axis limits, and post-processor settings.',
    icon: '\u{1F5A5}',
  },
  {
    number: 2,
    title: 'Import a model',
    description: 'Drag an STL or DXF file into the viewport, or use the Browse button. The 3D preview shows your model relative to the stock.',
    icon: '\u{1F4C4}',
  },
  {
    number: 3,
    title: 'Create operations',
    description: 'Add machining operations (roughing, finishing, contouring, etc.) from the left panel. Set your material to auto-calculate feeds and speeds.',
    icon: '\u{1F529}',
  },
  {
    number: 4,
    title: 'Generate G-code',
    description: 'Press the Generate button (or F5) to produce G-code. Review the output, export it, or send it directly to your machine.',
    icon: '\u25B6',
  },
]

// ── Component ────────────────────────────────────────────────────────────────

export function OnboardingOverlay({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [activeStep, setActiveStep] = useState(0)

  const handleDismiss = (): void => {
    if (dontShowAgain) {
      dismissOnboarding()
    }
    onDismiss()
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <h1 id="onboarding-title" className="onboarding-title">
            Welcome to WorkTrackCAM
          </h1>
          <p className="onboarding-subtitle">
            Professional CAM software for CNC milling, routing, and FDM printing.
          </p>
        </div>

        <div className="onboarding-steps">
          {STEPS.map((step, i) => (
            <button
              key={step.number}
              type="button"
              className={`onboarding-step${activeStep === i ? ' onboarding-step--active' : ''}`}
              onClick={() => setActiveStep(i)}
            >
              <div className="onboarding-step__icon">{step.icon}</div>
              <div className="onboarding-step__number">Step {step.number}</div>
              <div className="onboarding-step__title">{step.title}</div>
              <div className="onboarding-step__desc">{step.description}</div>
            </button>
          ))}
        </div>

        <div className="onboarding-footer">
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={e => setDontShowAgain(e.target.checked)}
            />
            Don't show this again
          </label>
          <div className="flex-spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleDismiss}
          >
            Skip
          </button>
          <button
            type="button"
            className="onboarding-start-btn"
            onClick={handleDismiss}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * OnboardingOverlay -- "What's new" / quick-tour reference panel.
 *
 * History: was originally a 4-card first-run overlay tied to a
 * localStorage flag. As of the first-launch wizard rollout
 * (`FirstLaunchWizard.tsx`), the **first-run trigger is owned by the
 * wizard** and persisted via `appSettings.hasCompletedOnboarding`.
 *
 * This component is now reachable on demand from the command palette
 * ("Show app tour…") and from the Help drawer as a quick reminder of
 * the four core steps of a WorkTrack3D workflow. The educational
 * content was preserved verbatim so users who liked it still have it.
 *
 * The legacy `fab-onboarding-dismissed-v1` localStorage key is no
 * longer read or written -- the wizard's settings flag supersedes it.
 */
import React, { useState } from 'react'

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
  const [activeStep, setActiveStep] = useState(0)

  const handleDismiss = (): void => {
    onDismiss()
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <h1 id="onboarding-title" className="onboarding-title">
            Welcome to WorkTrack3D
          </h1>
          <p className="onboarding-subtitle">
            Professional CAD-to-CAM software for design, CNC milling, routing, and FDM printing.
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
          <span className="onboarding-checkbox-label">
            App tour — open from Help anytime
          </span>
          <div className="flex-spacer" />
          <button
            type="button"
            className="onboarding-start-btn"
            onClick={handleDismiss}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

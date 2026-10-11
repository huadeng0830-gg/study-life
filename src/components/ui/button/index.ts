import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'ui-button group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap border border-transparent select-none disabled:opacity-50 aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground not-disabled:not-aria-disabled:hover:bg-primary-hover',
        outline: 'border-border bg-card text-foreground not-disabled:not-aria-disabled:hover:bg-muted aria-expanded:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground not-disabled:not-aria-disabled:hover:bg-accent aria-expanded:bg-accent',
        ghost: 'bg-transparent text-foreground not-disabled:not-aria-disabled:hover:bg-muted aria-expanded:bg-muted',
        destructive: 'bg-destructive/10 not-disabled:not-aria-disabled:hover:bg-destructive/20 text-destructive',
        link: 'text-primary underline-offset-4 not-disabled:not-aria-disabled:hover:underline',
      },
      size: {
        'default': '',
        'xs': 'ui-button-xs',
        'sm': 'ui-button-sm',
        'lg': 'ui-button-lg',
        'icon': 'ui-button-icon',
        'icon-xs': 'ui-button-icon-xs',
        'icon-sm': 'ui-button-icon-sm',
        'icon-lg': 'ui-button-icon-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>

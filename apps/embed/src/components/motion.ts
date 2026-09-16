import type { FeatureBundle, Variants } from 'motion/react';

/** Animation features are code split out of the initial iframe load. */
export const loadMotionFeatures = (): Promise<FeatureBundle> =>
  import('./motion-features').then((module) => module.default);

/** `--ease-out` and `--ease-drawer` from the brief, as motion easing arrays. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export type DialogVariant = 'dialog' | 'sheet';

export interface PresenceCustom {
  variant: DialogVariant;
  reduced: boolean;
  /** Keyboard initiated close: opacity only. */
  keyboard: boolean;
}

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } },
};

export const panelVariants: Variants = {
  hidden: ({ variant, reduced }: PresenceCustom) => {
    if (reduced) return { opacity: 0 };
    return variant === 'sheet'
      ? { opacity: 1, transform: 'translateY(100%)' }
      : { opacity: 0, transform: 'scale(0.97)' };
  },
  visible: ({ variant, reduced }: PresenceCustom) => {
    if (reduced) return { opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } };
    return variant === 'sheet'
      ? {
          opacity: 1,
          transform: 'translateY(0%)',
          transition: { duration: 0.3, ease: EASE_DRAWER },
          transitionEnd: { transform: 'none' },
        }
      : {
          opacity: 1,
          transform: 'scale(1)',
          transition: { duration: 0.2, ease: EASE_OUT },
          transitionEnd: { transform: 'none' },
        };
  },
  exit: ({ variant, reduced, keyboard }: PresenceCustom) => {
    if (reduced || keyboard) {
      return {
        opacity: 0,
        transition: { duration: variant === 'sheet' ? 0.2 : 0.15, ease: EASE_OUT },
      };
    }
    return variant === 'sheet'
      ? { transform: 'translateY(100%)', transition: { duration: 0.2, ease: EASE_OUT } }
      : { opacity: 0, transform: 'scale(0.97)', transition: { duration: 0.15, ease: EASE_OUT } };
  },
};

export interface ScreenCustom {
  direction: 1 | -1;
  /** Reduced motion or keyboard initiated: opacity only. */
  opacityOnly: boolean;
}

export const screenVariants: Variants = {
  enter: ({ direction, opacityOnly }: ScreenCustom) =>
    opacityOnly
      ? { opacity: 0 }
      : { opacity: 0, transform: `translateX(${String(8 * direction)}px)`, filter: 'blur(2px)' },
  center: ({ opacityOnly }: ScreenCustom) =>
    opacityOnly
      ? { opacity: 1, transition: { duration: 0.15, ease: EASE_OUT } }
      : {
          opacity: 1,
          transform: 'translateX(0px)',
          filter: 'blur(0px)',
          transition: { duration: 0.15, ease: EASE_OUT },
          transitionEnd: { transform: 'none', filter: 'none' },
        },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } },
};

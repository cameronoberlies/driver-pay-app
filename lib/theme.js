/**
 * Centralized Design System
 * All colors, spacing, typography, and component styles in one place.
 */

export const colors = {
  // Primary
  primary: '#f5a623',
  primaryDim: 'rgba(245, 166, 35, 0.12)',
  primaryBorder: 'rgba(245, 166, 35, 0.3)',

  // Backgrounds
  bg: '#0a0a0a',
  surface: '#111111',
  surfaceElevated: '#161616',
  surfaceBorder: '#1e1e1e',

  // Text
  textPrimary: '#ffffff',
  textSecondary: '#999999',
  textTertiary: '#666666',
  textMuted: '#444444',

  // Borders
  border: '#1e1e1e',
  borderLight: '#2a2a2a',

  // Status
  success: '#34c759',
  successDim: 'rgba(52, 199, 89, 0.12)',
  successBorder: 'rgba(52, 199, 89, 0.25)',

  error: '#ff453a',
  errorDim: 'rgba(255, 69, 58, 0.12)',
  errorBorder: 'rgba(255, 69, 58, 0.25)',

  warning: '#ff9f0a',
  warningDim: 'rgba(255, 159, 10, 0.12)',
  warningBorder: 'rgba(255, 159, 10, 0.25)',

  info: '#0a84ff',
  infoDim: 'rgba(10, 132, 255, 0.12)',
  infoBorder: 'rgba(10, 132, 255, 0.25)',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.75)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

export const typography = {
  // Display
  displayLg: { fontSize: 44, fontWeight: '900', letterSpacing: -1 },
  displayMd: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  displaySm: { fontSize: 24, fontWeight: '800', letterSpacing: 0 },

  // Headings
  h1: { fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  h2: { fontSize: 18, fontWeight: '700', letterSpacing: 0.2 },
  h3: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },

  // Body
  bodyLg: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodySm: { fontSize: 13, fontWeight: '400', lineHeight: 18 },

  // Captions
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  captionSm: { fontSize: 11, fontWeight: '500', lineHeight: 14 },

  // Labels (uppercase tracking)
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  labelSm: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
};

// Reusable shadow styles
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
};

// Common component style presets
export const components = {
  // Screen container
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenContent: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxxl,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardAccent: (color = colors.info) => ({
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: color,
    padding: spacing.lg,
    marginBottom: spacing.md,
  }),

  // Inputs
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
  },

  // Buttons
  buttonPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonPrimaryText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutlineText: {
    color: colors.textTertiary,
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1,
  },
  buttonDisabled: {
    opacity: 0.4,
  },

  // Pills / Chips
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryDim,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  pillTextActive: {
    color: colors.primary,
  },

  // Status badge
  badge: (color) => ({
    borderWidth: 1,
    borderColor: color,
    backgroundColor: color + '15',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  }),
  badgeText: (color) => ({
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: color,
  }),

  // Section headers
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxxl,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },

  // Error state
  errorText: {
    color: colors.textTertiary,
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  retryText: {
    color: colors.primary,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
};

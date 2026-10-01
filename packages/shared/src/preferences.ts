export const colorModes = ["system", "light", "dark"] as const;
export type ColorMode = (typeof colorModes)[number];

export const textSizes = [0.875, 0.9375, 1, 1.125, 1.25] as const;
export type TextSize = (typeof textSizes)[number];

export const densities = ["default", "compact"] as const;
export type Density = (typeof densities)[number];

export const fonts = ["default", "readable"] as const;
export type Font = (typeof fonts)[number];

export const dateFormats = ["auto", "DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof dateFormats)[number];

export const timeFormats = ["auto", "24h", "12h"] as const;
export type TimeFormat = (typeof timeFormats)[number];

export const numberFormats = ["auto", "en-US", "de-DE", "de-CH", "fr-FR"] as const;
export type NumberFormat = (typeof numberFormats)[number];

export const weekStarts = ["auto", "monday", "sunday", "saturday"] as const;
export type WeekStart = (typeof weekStarts)[number];

export const accentColors = ["petrol", "blue", "violet", "amber", "red", "green", "gray"] as const;
export type AccentColor = (typeof accentColors)[number];

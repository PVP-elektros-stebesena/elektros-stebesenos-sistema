import { createTheme, type MantineColorsTuple } from '@mantine/core';

/* ── Figma Style-Guide colour palettes ────────────────────────── */

const dark: MantineColorsTuple = [
  '#EBEBEB', // 0 – text (Figma "White")
  '#B3B3B3', // 1
  '#A4A4A4', // 2
  '#909296', // 3
  '#656565', // 4 – accent
  '#525252', // 5
  '#3E3E3E', // 6 – card / surface
  '#323232', // 7 – body background
  '#2C2C2C', // 8
  '#1A1A1A', // 9
];

const primary: MantineColorsTuple = [
  '#FFF9E6', // 0
  '#FFEFC8', // 1
  '#FFE5A5', // 2
  '#FFDD91', // 3 – hover
  '#FFD475', // 4
  '#FFCC59', // 5 – default ★
  '#E8B94F', // 6
  '#C9A043', // 7
  '#AB8738', // 8
  '#8D6F2D', // 9
];

const secondary: MantineColorsTuple = [
  '#F0F8FD', // 0
  '#D5ECF8', // 1
  '#BBE0F3', // 2
  '#A2D5EE', // 3
  '#96D1EC', // 4
  '#8ACDEA', // 5 – default ★
  '#6FBBDF', // 6
  '#55A9D3', // 7
  '#3B97C7', // 8
  '#2185BB', // 9
];

const danger: MantineColorsTuple = [
  '#FDE8E8', // 0
  '#F8C5C5', // 1
  '#F3A2A2', // 2
  '#EE7F7F', // 3
  '#EB5D5D', // 4
  '#DB3C3C', // 5 – default ★
  '#C43434', // 6
  '#AD2D2D', // 7
  '#962626', // 8
  '#7F1F1F', // 9
];

/* ── Theme ────────────────────────────────────────────────────── */

export const theme = createTheme({
  primaryColor: 'primary',
  primaryShade: { light: 5, dark: 5 },
  autoContrast: true,

  fontFamily: "'Roboto', sans-serif",
  headings: {
    fontFamily: "'Roboto', sans-serif",
    fontWeight: '400',
    sizes: {
      h1: { fontSize: '2.5rem',  lineHeight: '1' },
      h2: { fontSize: '2.25rem', lineHeight: '1' },
      h3: { fontSize: '2rem',    lineHeight: '1' },
      h4: { fontSize: '1.5rem',  lineHeight: '1' },
    },
  },

  colors: { dark, primary, secondary, danger },

  components: {
    Button: {
      defaultProps: {
        radius: 'xl',
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
      },
    },
    Badge: {
      defaultProps: {
        radius: 'xl',
      },
    },
  },
});
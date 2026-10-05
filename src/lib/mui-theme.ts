import { createTheme, type Components, type Theme } from '@mui/material/styles';

// Give inputs an explicit background + text colour instead of MUI's default
// transparent background. Phone-level "force dark" modes (ColorOS/Oppo,
// HeyTap browser, MIUI, Samsung) recolour elements individually: with a
// transparent field they darkened the card behind it but left the text dark,
// so typed values (e.g. Expense amount) became invisible. Explicit pairs get
// recoloured together and stay readable.
const inputOverrides: Components<Omit<Theme, 'components'>> = {
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme }) => ({ backgroundColor: theme.palette.background.paper }),
      input: ({ theme }) => ({
        color: theme.palette.text.primary,
        WebkitTextFillColor: theme.palette.text.primary,
      }),
    },
  },
};

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#ec4899', // pink-500
    },
    secondary: {
      main: '#7c3aed', // purple-600
    },
    background: {
      default: '#ffffff',
      paper: '#ffffff',
    },
  },
  components: inputOverrides,
  typography: {
    fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ec4899',
    },
    secondary: {
      main: '#7c3aed',
    },
    background: {
      default: '#0f172a',
      paper: '#0b1220',
    },
  },
  components: inputOverrides,
  typography: {
    fontFamily: 'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  },
});

import { createDiscreteApi, darkTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';

const monochromeThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#ffffff',
    primaryColorHover: '#f4f4f5',
    primaryColorPressed: '#e4e4e7',
    primaryColorSuppl: '#ffffff',
    infoColor: '#ffffff',
    infoColorHover: '#f4f4f5',
    warningColor: '#ffffff',
    warningColorHover: '#f4f4f5',
    errorColor: '#f43f5e',
    errorColorHover: '#fb7185',
    bodyColor: '#09090b',
    cardColor: '#121216',
    modalColor: '#121216',
    popoverColor: '#18181b',
    borderColor: '#27272a',
    textColorBase: '#ffffff',
    textColor1: '#ffffff',
    textColor2: '#d4d4d8',
    textColor3: '#a1a1aa',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontFamilyMono: 'ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
  },
  Button: {
    borderRadiusMedium: '8px',
    borderRadiusSmall: '6px',
    borderRadiusTiny: '4px',
    fontWeight: '500',
    colorPrimary: '#ffffff',
    colorHoverPrimary: '#f4f4f5',
    colorPressedPrimary: '#e4e4e7',
    textColorPrimary: '#09090b',
    textColorHoverPrimary: '#000000',
    textColorPressedPrimary: '#000000',
    colorSecondary: '#18181b',
    textColorSecondary: '#ffffff',
    borderPrimary: '1px solid #ffffff',
  },
  Dialog: {
    borderRadius: '14px',
    color: '#121216',
    titleTextColor: '#ffffff',
    textColor: '#a1a1aa',
    border: '1px solid #27272a',
    iconColor: '#ffffff',
    iconColorWarning: '#ffffff',
    iconColorError: '#f43f5e',
    iconColorInfo: '#ffffff',
    iconColorSuccess: '#ffffff',
    closeColorHover: '#ffffff',
    closeIconColor: '#a1a1aa',
    closeIconColorHover: '#ffffff',
  },
  Card: {
    color: '#121216',
    borderColor: '#27272a',
    borderRadius: '12px',
  },
  Modal: {
    color: '#121216',
    borderColor: '#27272a',
    borderRadius: '14px',
  },
};

export const { message, dialog, notification, loadingBar } = createDiscreteApi(
  ['message', 'dialog', 'notification', 'loadingBar'],
  {
    configProviderProps: {
      theme: darkTheme,
      themeOverrides: monochromeThemeOverrides,
    },
    messageProviderProps: {
      placement: 'top',
      keepAliveOnHover: true,
      containerStyle: {
        top: '48px',
      },
    },
    notificationProviderProps: {
      placement: 'top-right',
      keepAliveOnHover: true,
      containerStyle: {
        top: '48px',
      },
    },
  }
);

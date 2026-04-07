export type UIFontOption = {
  value: string;
  label: string;
  family: string;
};

export const UI_FONT_OPTIONS: UIFontOption[] = [
  {
    value: "default-sans",
    label: "標準 Sans",
    family: '"Inter", "Segoe UI", "Noto Sans JP", system-ui, sans-serif',
  },
  {
    value: "noto-sans",
    label: "Noto Sans JP",
    family: '"Noto Sans JP", "Segoe UI", system-ui, sans-serif',
  },
  {
    value: "yu-gothic",
    label: "Yu Gothic UI",
    family: '"Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif',
  },
  {
    value: "biz-udp",
    label: "BIZ UDPGothic",
    family: '"BIZ UDPGothic", "Yu Gothic UI", "Meiryo", sans-serif',
  },
  {
    value: "serif",
    label: "Serif",
    family: '"BIZ UDPMincho", "Yu Mincho", "Hiragino Mincho ProN", serif',
  },
  {
    value: "reading-serif",
    label: "Reading Serif",
    family: '"Noto Serif JP", "BIZ UDPMincho", "Yu Mincho", "Hiragino Mincho ProN", serif',
  },
];

export const DEFAULT_UI_FONT = UI_FONT_OPTIONS[0].value;

export function getUIFontFamily(value?: string | null) {
  return UI_FONT_OPTIONS.find((option) => option.value === value)?.family ?? UI_FONT_OPTIONS[0].family;
}

export function applyUIFont(value?: string | null) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font-family", getUIFontFamily(value));
}

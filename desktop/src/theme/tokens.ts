import {useEffect, useState} from 'react';
export type ThemeMode = 'system' | 'light' | 'dark';
const eventName = 'interview:appearance';
export function getAppearance(): {theme: ThemeMode; font: number} {
  const theme = localStorage.getItem('theme');
  const font = Number(localStorage.getItem('answer_font') || 16);
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    font: [14, 16, 18].includes(font) ? font : 16,
  };
}
export function applyAppearance(theme: ThemeMode, font: number) {
  localStorage.setItem('theme', theme);
  localStorage.setItem('answer_font', String(font));
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--answer-size', `${font}px`);
  window.dispatchEvent(new Event(eventName));
}
export function useDarkMode() {
  const [dark, setDark] = useState(() => getAppearance().theme === 'dark');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const {theme, font} = getAppearance();
      const isDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      document.documentElement.style.setProperty('--answer-size', `${font}px`);
      setDark(isDark);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener(eventName, update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener(eventName, update);
    };
  }, []);
  return {dark, toggle: () => applyAppearance(dark ? 'light' : 'dark', getAppearance().font)};
}

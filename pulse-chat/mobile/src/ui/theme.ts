import { useColorScheme } from 'react-native';

const light = {
  bg: '#FFFFFF',
  surface: '#F3F5F8',
  text: '#0F1720',
  textDim: '#5B6773',
  border: '#E3E7EC',
  primary: '#2E7DFF',
  onPrimary: '#FFFFFF',
  bubbleMine: '#D9E8FF',
  bubbleTheirs: '#F1F3F6',
  tickRead: '#2E7DFF',
  tickDim: '#8A95A1',
  danger: '#D93A3A',
  online: '#22B14C',
};

const dark: typeof light = {
  bg: '#0B1218',
  surface: '#141D26',
  text: '#E8EDF2',
  textDim: '#8A97A4',
  border: '#202B36',
  primary: '#5B9BFF',
  onPrimary: '#06101A',
  bubbleMine: '#1C3A63',
  bubbleTheirs: '#1A242E',
  tickRead: '#5B9BFF',
  tickDim: '#7A8794',
  danger: '#FF6B6B',
  online: '#3DD16A',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

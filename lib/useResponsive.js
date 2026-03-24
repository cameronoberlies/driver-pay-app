import { useWindowDimensions } from 'react-native';

export default function useResponsive() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 700;
  const isWide = width >= 1000;
  const contentWidth = isTablet ? Math.min(width - 80, 700) : width;
  const columns = isWide ? 3 : isTablet ? 2 : 1;

  return { width, isTablet, isWide, contentWidth, columns };
}

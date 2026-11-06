import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import type { DifferenceType } from '@/types/comparison';

export const TONE: Record<DifferenceType, { badge: string; rail: string; dot: string; Icon: typeof Plus }> = {
  added: { badge: 'bg-success-tint text-success', rail: 'border-l-success', dot: 'bg-[#bfe6cd] ring-success', Icon: Plus },
  removed: { badge: 'bg-danger-tint text-danger', rail: 'border-l-danger', dot: 'bg-[#f4c4bf] ring-danger', Icon: Minus },
  changed: { badge: 'bg-accent-tint text-accent-strong', rail: 'border-l-accent', dot: 'bg-[#d9cfe8] ring-plum', Icon: ArrowLeftRight },
};

/**
 * The little bit of view state that spans screens.
 *
 * Only the top bar's filters live here. Everything else a screen needs comes
 * from its own query — a shared store that grows past this becomes the reason
 * two screens disagree about what they are showing.
 */

import { create } from 'zustand';

interface ViewState {
  /** Null means every plant. */
  plantId: string | null;
  setPlantId: (plantId: string | null) => void;
}

export const useViewState = create<ViewState>((set) => ({
  plantId: null,
  setPlantId: (plantId) => set({ plantId }),
}));

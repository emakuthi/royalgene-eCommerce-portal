import { create } from 'zustand';
import { persist, createJSONStorage, type PersistStorage } from 'zustand/middleware';
import type { User, CartItem, Shop, PortalUser } from './types';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string, size: string, color: string) => void;
  updateQuantity: (productId: string, size: string, color: string, quantity: number) => void;
  clearCart: () => void;
  getTotal: () => number;
}

interface PortalState {
  currentShop: Shop | null;
  currentPortalUser: PortalUser | null;
  setCurrentShop: (shop: Shop) => void;
  setCurrentPortalUser: (user: PortalUser) => void;
  clearPortalContext: () => void;
  _hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
}

// Custom storage that only works on client-side
// Use `unknown` for the persisted value type to avoid `any` and keep it generic
const clientStorage: PersistStorage<unknown> | undefined = typeof window !== 'undefined'
  ? createJSONStorage(() => localStorage)
  : undefined;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: 'auth-storage',
      storage: clientStorage,
      skipHydration: true,
    }
  )
);

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => set((state) => {
        const existingItemIndex = state.items.findIndex(
          i => i.productId === item.productId && i.size === item.size && i.color === item.color
        );

        if (existingItemIndex > -1) {
          const newItems = [...state.items];
          newItems[existingItemIndex].quantity += item.quantity;
          return { items: newItems };
        }

        return { items: [...state.items, item] };
      }),
      removeItem: (productId, size, color) => set((state) => ({
        items: state.items.filter(
          item => !(item.productId === productId && item.size === size && item.color === color)
        ),
      })),
      updateQuantity: (productId, size, color, quantity) => set((state) => {
        if (quantity <= 0) {
          return {
            items: state.items.filter(
              item => !(item.productId === productId && item.size === size && item.color === color)
            ),
          };
        }

        const newItems = state.items.map(item =>
          item.productId === productId && item.size === size && item.color === color
            ? { ...item, quantity }
            : item
        );
        return { items: newItems };
      }),
      clearCart: () => set({ items: [] }),
      getTotal: () => {
        const state = get();
        return state.items.reduce((total, item) => total + (item.price * item.quantity), 0);
      },
    }),
    {
      name: 'cart-storage',
      storage: clientStorage,
      skipHydration: true,
    }
  )
);

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      currentShop: null,
      currentPortalUser: null,
      _hasHydrated: false,
      setCurrentShop: (shop) => set({ currentShop: shop }),
      setCurrentPortalUser: (user) => set({ currentPortalUser: user }),
      clearPortalContext: () => set({ currentShop: null, currentPortalUser: null }),
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),
    }),
    {
      name: 'portal-storage',
      storage: clientStorage,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);

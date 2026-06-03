import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { OVERLAY_PORTAL_HOST_Z_INDEX } from '@/components/ui/overlay/overlayStacking';

type OverlayPortalDispatch = Readonly<{
    setPortalNode: (id: string, node: React.ReactNode) => void;
    removePortalNode: (id: string) => void;
}>;

type OverlayPortalStore = OverlayPortalDispatch & Readonly<{
    getSnapshot: () => ReadonlyMap<string, React.ReactNode>;
    subscribe: (listener: () => void) => () => void;
}>;

const OverlayPortalStoreContext = React.createContext<OverlayPortalStore | null>(null);

function createOverlayPortalStore(): OverlayPortalStore {
    let nodes = new Map<string, React.ReactNode>();
    const listeners = new Set<() => void>();

    const emit = () => {
        for (const listener of listeners) {
            listener();
        }
    };

    return {
        setPortalNode: (id, node) => {
            if (nodes.get(id) === node) return;
            const next = new Map(nodes);
            next.set(id, node);
            nodes = next;
            emit();
        },
        removePortalNode: (id) => {
            if (!nodes.has(id)) return;
            const next = new Map(nodes);
            next.delete(id);
            nodes = next;
            emit();
        },
        getSnapshot: () => nodes,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function OverlayPortalProvider(props: { children: React.ReactNode }) {
    const storeRef = React.useRef<OverlayPortalStore | null>(null);
    if (storeRef.current == null) {
        storeRef.current = createOverlayPortalStore();
    }

    return (
        <OverlayPortalStoreContext.Provider value={storeRef.current}>
            {props.children}
        </OverlayPortalStoreContext.Provider>
    );
}

export function useOverlayPortal() {
    return React.useContext(OverlayPortalStoreContext);
}

function useOverlayPortalNodes() {
    const store = React.useContext(OverlayPortalStoreContext);
    return React.useSyncExternalStore(
        store?.subscribe ?? (() => () => {}),
        store?.getSnapshot ?? (() => null),
        store?.getSnapshot ?? (() => null),
    );
}

export function OverlayPortalHost(props: {
    pointerEvents?: 'box-none' | 'none' | 'auto' | 'box-only';
    zIndex?: number;
} = {}) {
    const nodes = useOverlayPortalNodes();
    if (!nodes || nodes.size === 0) return null;

    const zIndex = props.zIndex ?? OVERLAY_PORTAL_HOST_Z_INDEX;

    return (
        <View
            // Required on native: Popover measures the portal root to derive anchor-relative coordinates.
            // Collapsable views can be optimized away, producing invalid measurements (e.g. y=0 in contained modals).
            collapsable={false}
            pointerEvents={props.pointerEvents ?? 'box-none'}
            style={[StyleSheet.absoluteFill, { zIndex, elevation: zIndex }]}
        >
            {Array.from(nodes.entries()).map(([id, node]) => (
                <React.Fragment key={id}>
                    {node}
                </React.Fragment>
            ))}
        </View>
    );
}

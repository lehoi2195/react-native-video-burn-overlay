import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type {
  EditableLayer,
  LayerFieldPatch,
  OverlayLayerType,
} from '../../types';
import { createBlankLayer, switchLayerType } from '../../utils/layerFactory';
import LayerCard from './LayerCard';

interface LayerListEditorProps {
  layers: EditableLayer[];
  onLayersChange: (next: EditableLayer[]) => void;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Add/remove/reorder layers and expand one at a time to edit its own fields. */
export default function LayerListEditor({
  layers,
  onLayersChange,
}: LayerListEditorProps): ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(
    layers[0]?.id ?? null
  );
  const previousLayerIdsRef = useRef<string[]>(layers.map((layer) => layer.id));

  // A preset swap replaces every id at once; re-expand the first card, not a now-missing one.
  // A manual collapse (expandedId -> null) must NOT be overridden, so only react to id-set changes.
  useEffect(() => {
    const previousIds = previousLayerIdsRef.current;
    const currentIds = layers.map((layer) => layer.id);
    previousLayerIdsRef.current = currentIds;

    const isFullReplace =
      currentIds.length > 0 &&
      currentIds.every((id) => !previousIds.includes(id));

    if (isFullReplace) {
      setExpandedId(currentIds[0] ?? null);
    } else if (expandedId !== null && !currentIds.includes(expandedId)) {
      setExpandedId(currentIds[0] ?? null);
    }
  }, [layers, expandedId]);

  const handleAdd = useCallback((): void => {
    const layer = createBlankLayer('text');
    onLayersChange([...layers, layer]);
    setExpandedId(layer.id);
  }, [layers, onLayersChange]);

  const handleRemove = useCallback(
    (id: string): void => {
      onLayersChange(layers.filter((layer) => layer.id !== id));
    },
    [layers, onLayersChange]
  );

  const handleMove = useCallback(
    (index: number, direction: -1 | 1): void => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= layers.length) {
        return;
      }
      onLayersChange(moveItem(layers, index, targetIndex));
    },
    [layers, onLayersChange]
  );

  const handlePatch = useCallback(
    (id: string, patch: LayerFieldPatch): void => {
      onLayersChange(
        layers.map((layer) =>
          layer.id === id ? ({ ...layer, ...patch } as EditableLayer) : layer
        )
      );
    },
    [layers, onLayersChange]
  );

  const handleChangeType = useCallback(
    (id: string, type: OverlayLayerType): void => {
      onLayersChange(
        layers.map((layer) =>
          layer.id === id ? switchLayerType(layer, type) : layer
        )
      );
    },
    [layers, onLayersChange]
  );

  return (
    <View>
      {layers.map((layer, index) => (
        <LayerCard
          key={layer.id}
          layer={layer}
          index={index}
          total={layers.length}
          isExpanded={expandedId === layer.id}
          onToggleExpand={() =>
            setExpandedId(expandedId === layer.id ? null : layer.id)
          }
          onPatch={(patch) => handlePatch(layer.id, patch)}
          onChangeType={(type) => handleChangeType(layer.id, type)}
          onRemove={() => handleRemove(layer.id)}
          onMoveUp={() => handleMove(index, -1)}
          onMoveDown={() => handleMove(index, 1)}
          canRemove={layers.length > 1}
        />
      ))}
      <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
        <Text style={styles.addButtonText}>+ Add layer</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
    marginBottom: 8,
  },
  addButtonText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '600',
  },
});

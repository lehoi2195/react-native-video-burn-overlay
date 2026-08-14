import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type {
  EditableLayer,
  LayerFieldPatch,
  OverlayLayerType,
} from '../../types';
import { LAYER_TYPE_OPTIONS } from '../../constants/layerOptions';
import BaseLayerFields from './BaseLayerFields';
import ImageLayerFields from './ImageLayerFields';
import TextLayerFields from './TextLayerFields';
import TileFields from './TileFields';

interface LayerCardProps {
  layer: EditableLayer;
  index: number;
  total: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: LayerFieldPatch) => void;
  onChangeType: (type: OverlayLayerType) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canRemove: boolean;
}

/** One layer's card: type switch, reorder/remove, and its own field editors when expanded. */
export default function LayerCard({
  layer,
  index,
  total,
  isExpanded,
  onToggleExpand,
  onPatch,
  onChangeType,
  onRemove,
  onMoveUp,
  onMoveDown,
  canRemove,
}: LayerCardProps): ReactElement {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={onToggleExpand}>
        <Text style={styles.title}>
          Layer {index + 1}
          {index === total - 1 ? ' (top)' : ''}
        </Text>
        <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      <View style={styles.typeRow}>
        {LAYER_TYPE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChangeType(option.value)}
            style={[
              styles.typeChip,
              layer.type === option.value && styles.typeChipSelected,
            ]}
          >
            <Text
              style={[
                styles.typeChipText,
                layer.type === option.value && styles.typeChipTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={styles.spacer} />
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onMoveUp}
          disabled={index === 0}
        >
          <Text style={[styles.iconText, index === 0 && styles.iconDisabled]}>
            ↑
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onMoveDown}
          disabled={index === total - 1}
        >
          <Text
            style={[
              styles.iconText,
              index === total - 1 && styles.iconDisabled,
            ]}
          >
            ↓
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onRemove}
          disabled={!canRemove}
        >
          <Text style={[styles.iconText, !canRemove && styles.iconDisabled]}>
            ✕
          </Text>
        </TouchableOpacity>
      </View>

      {isExpanded ? (
        <View style={styles.body}>
          <BaseLayerFields layer={layer} onChange={onPatch} />
          {layer.type === 'image' ? (
            <ImageLayerFields layer={layer} onChange={onPatch} />
          ) : (
            <TextLayerFields layer={layer} onChange={onPatch} />
          )}
          <TileFields
            tile={layer.tile}
            onTileChange={(tile) => onPatch({ tile })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '600',
  },
  chevron: {
    color: '#6C6C70',
    fontSize: 12,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  typeChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#E5E5EA',
    marginRight: 8,
  },
  typeChipSelected: {
    backgroundColor: '#AF52DE',
  },
  typeChipText: {
    color: '#1C1C1E',
    fontSize: 12,
    fontWeight: '600',
  },
  typeChipTextSelected: {
    color: '#FFFFFF',
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
    marginLeft: 6,
  },
  iconText: {
    color: '#1C1C1E',
    fontSize: 13,
  },
  iconDisabled: {
    color: '#C6C6C8',
  },
  body: {
    marginTop: 6,
  },
});

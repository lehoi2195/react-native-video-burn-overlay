import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PresetButtonsProps {
  onLogoCaption: () => void;
  onStockWatermark: () => void;
}

/** The two headline one-tap demos: simultaneous multi-layer, and the tile path. */
export default function PresetButtons({
  onLogoCaption,
  onStockWatermark,
}: PresetButtonsProps): ReactElement {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, styles.logoCaptionButton]}
        onPress={onLogoCaption}
      >
        <Text style={styles.buttonText}>Logo + caption</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, styles.stockWatermarkButton]}
        onPress={onStockWatermark}
      >
        <Text style={styles.buttonText}>Stock watermark</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  logoCaptionButton: {
    backgroundColor: '#34C759',
  },
  stockWatermarkButton: {
    backgroundColor: '#AF52DE',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

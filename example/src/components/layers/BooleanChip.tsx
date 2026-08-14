import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

interface BooleanChipProps {
  label: string;
  value: boolean;
  onToggle: (next: boolean) => void;
}

/** On/off chip toggle, matching the "No Stroke" chip pattern from StyleSettingsPanel. */
export default function BooleanChip({
  label,
  value,
  onToggle,
}: BooleanChipProps): ReactElement {
  return (
    <TouchableOpacity
      style={[styles.chip, value && styles.chipSelected]}
      onPress={() => onToggle(!value)}
    >
      <Text style={[styles.text, value && styles.textSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E5E5EA',
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: {
    backgroundColor: '#007AFF',
  },
  text: {
    color: '#1C1C1E',
    fontSize: 13,
  },
  textSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

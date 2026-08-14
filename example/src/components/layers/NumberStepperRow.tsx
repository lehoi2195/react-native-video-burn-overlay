import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { clamp } from '../../constants/styleOptions';

interface NumberStepperRowProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  /** Custom display for the value, e.g. `(v) => `${v}%`` — defaults to plain rounded number. */
  formatValue?: (value: number) => string;
}

/** Reusable −/+ stepper row, matching StyleSettingsPanel's existing stepper visuals. */
export default function NumberStepperRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  formatValue,
}: NumberStepperRowProps): ReactElement {
  const display = formatValue ? formatValue(value) : `${Math.round(value)}`;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => onChange(clamp(value - step, min, max))}
        >
          <Text style={styles.buttonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.value}>{display}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => onChange(clamp(value + step, min, max))}
        >
          <Text style={styles.buttonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
  },
  label: {
    color: '#6C6C70',
    fontSize: 12,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
  },
  buttonText: {
    color: '#1C1C1E',
    fontSize: 18,
    lineHeight: 20,
  },
  value: {
    color: '#1C1C1E',
    fontSize: 14,
    width: 70,
    textAlign: 'center',
  },
});

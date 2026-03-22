import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../lib/theme';

const API_KEY = 'pk.ad8425665c12e1b7f5d7827258d59077';

export default function CityAutocomplete({ value, onChangeText, placeholder, style, placeholderTextColor }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);

  function handleChange(text) {
    onChangeText(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://api.locationiq.com/v1/autocomplete?key=${API_KEY}&q=${encodeURIComponent(text)}&countrycodes=us&limit=6&dedupe=1&tag=place:city,place:town,place:village`;
        const res = await fetch(url);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const cities = data.map(item => {
            const parts = item.display_name.split(', ');
            // Format: "City, State" from the full address
            const city = parts[0];
            const state = parts.length >= 3 ? parts[parts.length - 2] : '';
            return { key: item.place_id, city, state, display: state ? `${city}, ${state}` : city };
          });
          setSuggestions(cities);
          setShowDropdown(true);
        } else {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } catch (e) {
        console.log('City autocomplete error:', e);
      }
    }, 300);
  }

  function handleSelect(item) {
    onChangeText(item.display);
    setSuggestions([]);
    setShowDropdown(false);
  }

  return (
    <View style={s.wrapper}>
      <TextInput
        style={style}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        autoCapitalize="words"
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
      />
      {showDropdown && suggestions.length > 0 && (
        <View style={s.dropdown}>
          {suggestions.map(item => (
            <TouchableOpacity key={item.key} style={s.suggestion} onPress={() => handleSelect(item)}>
              <Text style={s.suggestionCity}>{item.city}</Text>
              {item.state ? <Text style={s.suggestionState}>{item.state}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: { position: 'relative', zIndex: 10 },
  dropdown: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.sm,
    marginTop: 2,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionCity: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  suggestionState: { fontSize: 12, color: colors.textSecondary },
});

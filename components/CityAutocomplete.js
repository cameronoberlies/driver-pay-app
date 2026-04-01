import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Keyboard } from 'react-native';
import { colors, spacing, radius } from '../lib/theme';

const API_KEY = 'pk.ad8425665c12e1b7f5d7827258d59077';

const STATE_ABBR = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  'District of Columbia': 'DC',
};

export default function CityAutocomplete({ value, onChangeText, placeholder, style, placeholderTextColor }) {
  const [suggestions, setSuggestions] = useState([]);
  const debounceRef = useRef(null);
  const justSelectedRef = useRef(false);
  const currentQueryRef = useRef('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }

    const query = (value || '').trim();
    if (query.length < 2) {
      setSuggestions([]);
      currentQueryRef.current = '';
      return;
    }

    currentQueryRef.current = query;

    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://api.locationiq.com/v1/autocomplete?key=${API_KEY}&q=${encodeURIComponent(query)}&countrycodes=us&limit=6&dedupe=1&tag=place:city,place:town,place:village`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (query !== currentQueryRef.current) return;

        if (Array.isArray(data) && data.length > 0) {
          const cities = data.map(item => {
            const city = item.address?.name || item.display_name.split(', ')[0];
            const state = item.address?.state || '';
            const stateAbbr = STATE_ABBR[state] || state;
            return { key: item.place_id, city, state: stateAbbr, display: stateAbbr ? `${city}, ${stateAbbr}` : city };
          });
          setSuggestions(cities);
        } else {
          setSuggestions([]);
        }
      } catch (e) {
        console.log('City autocomplete error:', e);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  function handleSelect(item) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    justSelectedRef.current = true;
    currentQueryRef.current = '';
    setSuggestions([]);
    onChangeText(item.display);
    Keyboard.dismiss();
  }

  return (
    <View style={s.wrapper}>
      <TextInput
        ref={inputRef}
        style={style}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        autoCapitalize="words"
        keyboardShouldPersistTaps="always"
      />
      {suggestions.length > 0 && (
        <View style={s.dropdown}>
          {suggestions.map(item => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [s.suggestion, pressed && s.suggestionPressed]}
              onPress={() => handleSelect(item)}
            >
              <Text style={s.suggestionCity}>{item.city}</Text>
              {item.state ? <Text style={s.suggestionState}>{item.state}</Text> : null}
            </Pressable>
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
    zIndex: 20,
  },
  suggestion: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionPressed: {
    backgroundColor: colors.primaryDim,
  },
  suggestionCity: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  suggestionState: { fontSize: 12, color: colors.textSecondary },
});

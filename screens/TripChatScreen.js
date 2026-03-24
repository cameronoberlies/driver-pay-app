import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  FlatList,
  Image,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { colors, spacing, radius, typography } from '../lib/theme';

export default function TripChatScreen({ trip, allProfiles, onClose }) {
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const flatListRef = useRef(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id);
    await loadMessages();

    const subscription = supabase
      .channel(`trip_messages:${trip.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_messages',
          filter: `trip_id=eq.${trip.id}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }

  async function loadMessages() {
    setLoading(true);
    const { data, error } = await supabase
      .from('trip_messages')
      .select('*')
      .eq('trip_id', trip.id)
      .order('created_at', { ascending: true });

    if (error) console.error('Error loading messages:', error);
    else setMessages(data || []);
    setLoading(false);
  }

  async function handleSend(imageUrl) {
    const hasText = messageText.trim();
    if (!hasText && !imageUrl) return;
    if (sending) return;

    setSending(true);
    const text = hasText ? messageText.trim() : null;
    if (hasText) setMessageText('');

    const { data, error } = await supabase.from('trip_messages').insert({
      trip_id: trip.id,
      sender_id: currentUserId,
      content: text || (imageUrl ? '📷 Photo' : ''),
      image_url: imageUrl || null,
    }).select().single();

    if (error) {
      console.error('Error sending message:', error);
      if (text) setMessageText(text);
    } else if (data) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        return [...prev, data];
      });
      supabase.functions.invoke('notify-trip-message', {
        body: { message_id: data.id },
      }).catch(() => {});
    }
    setSending(false);
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed to send images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setSending(true);

    try {
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${trip.id}/${Date.now()}.${ext}`;

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('trip-attachments')
        .upload(fileName, arrayBuffer, {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        Alert.alert('Upload Failed', uploadError.message);
        setSending(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('trip-attachments')
        .getPublicUrl(fileName);

      await handleSend(urlData.publicUrl);
    } catch (e) {
      console.error('Image send error:', e);
      Alert.alert('Error', 'Failed to send image.');
      setSending(false);
    }
  }

  function getSenderName(senderId) {
    const profile = allProfiles.find((p) => p.id === senderId);
    return profile?.name || 'Unknown';
  }

  function formatTime(dateString) {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatDateHeader(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderMessage({ item, index }) {
    const isMe = item.sender_id === currentUserId;
    const showDateHeader =
      index === 0 ||
      new Date(item.created_at).toDateString() !==
        new Date(messages[index - 1].created_at).toDateString();

    return (
      <View>
        {showDateHeader && (
          <View style={s.dateHeader}>
            <Text style={s.dateHeaderText}>
              {formatDateHeader(item.created_at)}
            </Text>
          </View>
        )}
        <View style={[s.messageBubble, isMe ? s.myMessage : s.theirMessage]}>
          {!isMe && (
            <Text style={s.senderName}>{getSenderName(item.sender_id)}</Text>
          )}
          {item.image_url && (
            <Image
              source={{ uri: item.image_url }}
              style={s.messageImage}
              resizeMode="cover"
            />
          )}
          {item.content && item.content !== '📷 Photo' && (
            <Text style={[s.messageText, !isMe && s.theirMessageText]}>
              {item.content}
            </Text>
          )}
          <Text style={[s.messageTime, !isMe && s.theirMessageTime]}>
            {formatTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : insets.top}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={onClose} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerInfo}>
          <Text style={s.headerTitle} numberOfLines={1}>{trip.city}</Text>
          <Text style={s.headerSubtitle}>
            {trip.crm_id || 'No CRM'} · {trip.trip_type === 'fly' ? '✈ Fly' : '🚗 Drive'}
          </Text>
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={s.messagesContent}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyText}>No messages yet</Text>
              <Text style={s.emptySubtext}>
                Start a conversation about this trip
              </Text>
            </View>
          }
        />
      )}

      {/* Input */}
      <View style={[s.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          style={s.photoBtn}
          onPress={handlePickImage}
          disabled={sending}
        >
          <Text style={s.photoBtnText}>📷</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          value={messageText}
          onChangeText={setMessageText}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[s.sendBtn, (!messageText.trim() || sending) && s.sendBtnDisabled]}
          onPress={() => handleSend()}
          disabled={!messageText.trim() || sending}
        >
          <Text style={s.sendBtnText}>{sending ? '...' : '→'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  backBtn: {
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
  },
  backText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  headerSubtitle: {
    ...typography.captionSm,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesContent: {
    padding: spacing.lg,
    flexGrow: 1,
  },
  dateHeader: {
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  dateHeaderText: {
    ...typography.captionSm,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  messageBubble: {
    maxWidth: '75%',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 2,
  },
  theirMessage: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 2,
  },
  senderName: {
    ...typography.labelSm,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  messageText: {
    ...typography.body,
    color: colors.bg,
    lineHeight: 20,
  },
  theirMessageText: {
    color: colors.textPrimary,
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  messageTime: {
    ...typography.captionSm,
    fontSize: 9,
    color: 'rgba(0, 0, 0, 0.4)',
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  theirMessageTime: {
    color: colors.textMuted,
  },
  emptyState: {
    paddingTop: spacing.xxxxl + 32,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    ...typography.captionSm,
    color: colors.textMuted,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  photoBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtnText: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.3,
  },
  sendBtnText: {
    fontSize: 20,
    color: colors.bg,
    fontWeight: '700',
  },
});

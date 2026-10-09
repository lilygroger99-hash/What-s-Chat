import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Phone: undefined;
  Otp: { phone: string; email?: string };
  ProfileSetup: undefined;
  Chats: undefined;
  NewChat: undefined;
  Chat: { chatId: string; title: string };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

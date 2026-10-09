import Constants from 'expo-constants';

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://10.0.2.2:8080';

/** Build-time flag: deliver login codes by email (server OTP_PROVIDER=smtp) instead of SMS. */
export const OTP_VIA_EMAIL: boolean = Boolean(Constants.expoConfig?.extra?.otpViaEmail);

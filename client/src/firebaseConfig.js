const WEB_CONFIG_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  databaseURL: 'VITE_FIREBASE_DATABASE_URL',
  appId: 'VITE_FIREBASE_APP_ID'
};

export function resolveFirebaseWebConfig(confirmed, env) {
  const configured = Object.values(WEB_CONFIG_KEYS).some(key => env[key]?.trim());
  const config = Object.fromEntries(Object.entries(WEB_CONFIG_KEYS).map(([key, envKey]) =>
    [key, configured ? env[envKey]?.trim() : confirmed[key]]));
  // Treat an explicit override as a complete configuration, so mixed projects cannot initialize.
  if (Object.values(config).some(value => !value)) throw new Error('게임 서버 설정이 필요합니다.');
  if (config.projectId !== confirmed.projectId) throw new Error('확인된 게임 서버 설정이 필요합니다.');
  return config;
}

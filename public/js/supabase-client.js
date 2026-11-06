(() => {
  'use strict';
  // The Supabase publishable key is designed for browser use. Access to user data
  // is enforced by PostgreSQL grants and Row Level Security, not by hiding this key.
  const SUPABASE_URL = 'https://eqrdzenoqvduboaxhsqb.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zfL4vCHOOY7dzNHE9oBnHw_adeph17x';

  let session = null;
  let initialized = false;
  let initializationError = null;
  let client = null;
  let authSubscription = null;

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    initializationError = new Error('Supabase client library did not load. Check your internet connection or CDN access.');
  } else {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null;
      emit('afhub-auth-change', { event, session });
    });
  }

  const ready = client
    ? client.auth.getSession().then(({ data, error }) => {
        if (error) throw error;
        session = data.session || null;
        initialized = true;
        emit('afhub-auth-ready', { session });
        return session;
      }).catch(error => {
        initializationError = error;
        initialized = true;
        emit('afhub-auth-ready', { session: null, error });
        return null;
      })
    : Promise.resolve(null).then(() => {
        initialized = true;
        emit('afhub-auth-ready', { session: null, error: initializationError });
        return null;
      });

  const api = {
    url: SUPABASE_URL,
    get client() { return client; },
    get session() { return session; },
    get user() { return session?.user || null; },
    get accessToken() { return session?.access_token || null; },
    get publishableKey() { return SUPABASE_PUBLISHABLE_KEY; },
    get ready() { return initialized; },
    get error() { return initializationError; },
    readyPromise: ready,
    async signUp({ email, password, displayName }) {
      if (!client) throw initializationError || new Error('Supabase is not available.');
      return client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } }
      });
    },
    async signIn(email, password) {
      if (!client) throw initializationError || new Error('Supabase is not available.');
      return client.auth.signInWithPassword({ email, password });
    },
    async signOut() {
      if (!client) throw initializationError || new Error('Supabase is not available.');
      return client.auth.signOut();
    },
    async getProfile() {
      if (!client || !session?.user) throw new Error('Sign in before loading your profile.');
      const { data, error } = await client
        .from('profiles')
        .select('user_id, username, display_name, avatar_path, bio, created_at, updated_at')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async updateProfile({ display_name, username, bio }) {
      if (!client || !session?.user) throw new Error('Sign in before updating your profile.');
      const update = { display_name, bio, updated_at: new Date().toISOString() };
      if (username) update.username = username;
      else update.username = null;
      const { data, error } = await client
        .from('profiles')
        .update(update)
        .eq('user_id', session.user.id)
        .select('user_id, username, display_name, avatar_path, bio, created_at, updated_at')
        .single();
      if (error) throw error;
      await client.auth.updateUser({ data: { display_name } });
      return data;
    },
    async connectionTest() {
      if (!client) throw initializationError || new Error('Supabase is not available.');
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return { connected: true, authenticated: !!data.session, email: data.session?.user?.email || null };
    }
  };

  window.AFCloud = api;
})();

/* ============ UltraTune — Spotify Web API (PKCE, no backend) ============ */
/*
 * Authorization Code + PKCE runs entirely in the browser; the token exchange
 * endpoint (accounts.spotify.com/api/token) allows CORS for PKCE clients.
 * The user supplies their own Client ID once (stored in localStorage) and the
 * redirect URI is simply this page's own URL.
 */

"use strict";

const Spotify = (() => {
  const LS_CLIENT = "ut_spotify_client_id";
  const LS_TOKEN = "ut_spotify_token";
  const LS_VERIFIER = "ut_pkce_verifier";
  const SCOPES = "user-read-private user-library-read playlist-read-private playlist-read-collaborative";

  const redirectUri = () => location.origin + location.pathname;

  const getClientId = () => localStorage.getItem(LS_CLIENT) || "";
  const setClientId = (id) => localStorage.setItem(LS_CLIENT, id.trim());

  function loadToken() {
    try { return JSON.parse(localStorage.getItem(LS_TOKEN)) || null; }
    catch { return null; }
  }
  function saveToken(tok) {
    tok.expires_at = Date.now() + (tok.expires_in - 60) * 1000;
    localStorage.setItem(LS_TOKEN, JSON.stringify(tok));
    return tok;
  }

  const loggedIn = () => !!loadToken();

  function logout() {
    localStorage.removeItem(LS_TOKEN);
  }

  // ---------- PKCE helpers ----------

  function randomString(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return [...bytes].map((b) => chars[b % chars.length]).join("");
  }

  async function challengeFrom(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function login() {
    const clientId = getClientId();
    if (!clientId) throw new Error("no-client-id");
    const verifier = randomString(64);
    localStorage.setItem(LS_VERIFIER, verifier);
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri(),
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: await challengeFrom(verifier),
    });
    location.href = "https://accounts.spotify.com/authorize?" + params;
  }

  /* Call on page load; returns true if we just completed a login redirect. */
  async function handleRedirect() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return false;
    history.replaceState({}, "", redirectUri()); // scrub ?code= from the URL
    const verifier = localStorage.getItem(LS_VERIFIER);
    if (!verifier) return false;
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getClientId(),
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new Error("Token exchange failed (" + res.status + ")");
    saveToken(await res.json());
    localStorage.removeItem(LS_VERIFIER);
    return true;
  }

  async function freshAccessToken() {
    let tok = loadToken();
    if (!tok) throw new Error("not-logged-in");
    if (Date.now() < tok.expires_at) return tok.access_token;
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: getClientId(),
        grant_type: "refresh_token",
        refresh_token: tok.refresh_token,
      }),
    });
    if (!res.ok) { logout(); throw new Error("not-logged-in"); }
    const next = await res.json();
    if (!next.refresh_token) next.refresh_token = tok.refresh_token;
    return saveToken(next).access_token;
  }

  // ---------- Web API ----------

  async function api(path) {
    const token = await freshAccessToken();
    const res = await fetch("https://api.spotify.com/v1" + path, {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) { logout(); throw new Error("not-logged-in"); }
    if (!res.ok) throw new Error("Spotify API error (" + res.status + ")");
    return res.json();
  }

  const me = () => api("/me");

  async function searchTracks(query) {
    const data = await api("/search?type=track&limit=25&q=" + encodeURIComponent(query));
    return data.tracks.items;
  }

  async function myPlaylists() {
    const data = await api("/me/playlists?limit=50");
    return data.items;
  }

  async function playlistTracks(playlistId) {
    const data = await api("/playlists/" + playlistId + "/tracks?limit=100");
    return data.items.map((it) => it.track).filter(Boolean);
  }

  async function savedTracks() {
    const data = await api("/me/tracks?limit=50");
    return data.items.map((it) => it.track);
  }

  return {
    redirectUri, getClientId, setClientId, loggedIn, login, logout,
    handleRedirect, me, searchTracks, myPlaylists, playlistTracks, savedTracks,
  };
})();

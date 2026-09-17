// Unity WebGL (Ep 0 / Ep 1) writes scores itself via FirebaseScoreBridge:
// a REST PATCH to users/{uid} with Firestore fields.tutorialScore.
// The compiled build has no .jslib, so it never calls CyberGuardBridge.
// Catch those writes (and any matching payload) and hand the number back.

export function parseGameScorePayload(payload) {
  const value = unwrapScoreValue(payload);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function installUnityScoreCapture(onScore) {
  if (typeof window === "undefined" || window.__cyberGuardScoreCaptureInstalled) {
    return () => {};
  }
  window.__cyberGuardScoreCaptureInstalled = true;

  const emit = (payload, source) => {
    const score = parseGameScorePayload(payload);
    if (score === null) return;
    onScore(score, source);
  };

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = async (input, init) => {
      const url = requestUrl(input);
      const body = init?.body ?? input?.body;
      if (looksLikeTutorialScore(url, body)) emit(body, "unity-fetch");
      const response = await originalFetch(input, init);
      if (looksLikeTutorialScore(url, body) || looksLikeTutorialScore(url, "")) {
        try {
          emit(await response.clone().text(), "unity-fetch-response");
        } catch {
          // Ignore unreadable responses; the request body is enough.
        }
      }
      return response;
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__cyberGuardUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function send(body) {
    const url = this.__cyberGuardUrl;
    if (looksLikeTutorialScore(url, body)) emit(body, "unity-xhr");
    this.addEventListener("load", () => {
      if (looksLikeTutorialScore(url, body) || looksLikeTutorialScore(url, this.responseText)) {
        emit(body, "unity-xhr");
        emit(this.responseText, "unity-xhr-response");
      }
    });
    return xhrSend.call(this, body);
  };

  return () => {
    if (originalFetch) window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = xhrOpen;
    XMLHttpRequest.prototype.send = xhrSend;
    window.__cyberGuardScoreCaptureInstalled = false;
  };
}

function looksLikeTutorialScore(url, body) {
  const urlText = String(url || "");
  const bodyText = payloadToText(body);
  return /tutorialScore/i.test(urlText) || /tutorialScore/i.test(bodyText);
}

function unwrapScoreValue(payload) {
  const parsed = coercePayload(payload);
  if (parsed == null) return NaN;
  if (typeof parsed === "number") return parsed;

  if (typeof parsed === "object") {
    const field = parsed.fields?.tutorialScore ?? parsed.tutorialScore ?? parsed.scoreValue ?? parsed.score;
    if (field && typeof field === "object") {
      return Number(field.integerValue ?? field.doubleValue ?? field.stringValue ?? field.value);
    }
    if (field != null && typeof field !== "object") return Number(field);

    const nested = parsed.data && parsed.data !== parsed ? unwrapScoreValue(parsed.data) : NaN;
    if (Number.isFinite(nested)) return nested;
  }

  return Number(parsed);
}

function coercePayload(payload) {
  if (payload == null) return null;
  if (typeof payload === "number") return payload;
  const text = payloadToText(payload).trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function payloadToText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof body === "number") return String(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  if (typeof body === "object" && !(body instanceof Blob)) {
    try {
      return JSON.stringify(body);
    } catch {
      return "";
    }
  }
  return "";
}

function requestUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  return input.url || "";
}

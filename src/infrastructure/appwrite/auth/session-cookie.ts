export const SESSION_COOKIE_NAME = "hft_session";

export interface SessionCookieDirective {
  readonly action: "set";
  readonly secret: string;
  readonly expire: string;
}

export interface ClearCookieDirective {
  readonly action: "clear";
}

export type AuthCookieDirective = SessionCookieDirective | ClearCookieDirective;

export interface SessionCookieAttributes {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly expires: Date;
}

export function buildSessionCookie(directive: SessionCookieDirective, secure: boolean): SessionCookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value: directive.secret,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: new Date(directive.expire),
  };
}

export function serializeClearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const CLEARED_SESSION_COOKIE: ClearCookieDirective = { action: "clear" };

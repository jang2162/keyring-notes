import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { ConfigStore, PasskeyConfig } from "./config.js";
import { PathError } from "./paths.js";

/**
 * 소유자 패스키(WebAuthn) 로그인. 비밀번호 로그인과 나란히 쓴다(비밀번호를 없애지는 않는다).
 *
 * rpID는 접속한 주소의 호스트 이름이다. 패스키는 등록한 주소에 묶이므로, 다른 주소(예: IP로 접속)에서는
 * 그 주소용으로 따로 등록해야 한다. 브라우저는 https(또는 localhost)에서만 패스키를 쓴다.
 * 요청의 Origin이 그 요청을 받은 호스트(또는 KEYRING_PUBLIC_URL)와 같을 때만 받는다.
 */
const CHALLENGE_TTL = 5 * 60_000;

interface Pending {
  kind: "register" | "login";
  challenge: string;
  origin: string;
  rpID: string;
  expires: number;
}

export class PasskeyError extends Error {}

export class PasskeyService {
  private pending = new Map<string, Pending>();

  constructor(
    private config: ConfigStore,
    /** 브라우저가 보는 공개 주소(리버스 프록시 뒤일 때) */
    private publicUrl?: string,
  ) {}

  /** 요청의 Origin을 확인하고 rpID를 정한다 */
  origin(origin: string | undefined, host: string | undefined, forwardedHost?: string): { origin: string; rpID: string } {
    if (!origin) throw new PathError("Origin 헤더가 없습니다");
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new PathError("Origin이 잘못되었습니다");
    }
    const allowed = new Set([host, forwardedHost, this.publicUrl ? new URL(this.publicUrl).host : undefined].filter(Boolean).map((h) => h!.toLowerCase()));
    if (!allowed.has(u.host.toLowerCase())) throw new PathError("다른 주소에서 온 요청입니다");
    return { origin: u.origin, rpID: u.hostname };
  }

  private remember(p: Omit<Pending, "expires">): string {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
    if (this.pending.size > 200) throw new PathError("진행 중인 패스키 요청이 너무 많습니다. 잠시 뒤 다시 하세요");
    const id = randomBytes(16).toString("base64url");
    this.pending.set(id, { ...p, expires: now + CHALLENGE_TTL });
    return id;
  }

  /** 한 번만 쓸 수 있다 */
  private take(id: unknown, kind: Pending["kind"]): Pending {
    const p = typeof id === "string" ? this.pending.get(id) : undefined;
    if (typeof id === "string") this.pending.delete(id);
    if (!p || p.kind !== kind || p.expires < Date.now()) throw new PasskeyError("패스키 요청이 만료되었습니다. 다시 하세요");
    return p;
  }

  list(): Omit<PasskeyConfig, "publicKey" | "counter">[] {
    return this.config.get().passkeys.map(({ publicKey: _k, counter: _c, ...rest }) => rest);
  }

  /** 이 주소(rpID)에서 쓸 수 있는 패스키가 있는지(로그인 화면에 단추를 보일지) */
  available(rpID: string): boolean {
    return this.config.get().passkeys.some((k) => k.rpID === rpID);
  }

  async registrationOptions(at: { origin: string; rpID: string }): Promise<{ id: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const cfg = this.config.get();
    const options = await generateRegistrationOptions({
      rpName: "Keyring Notes",
      rpID: at.rpID,
      userName: cfg.owner.name,
      userDisplayName: cfg.owner.name,
      userID: Buffer.from(cfg.passkeyUserId, "base64url"),
      attestationType: "none",
      excludeCredentials: cfg.passkeys.filter((k) => k.rpID === at.rpID).map((k) => ({ id: k.id, transports: k.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    return { id: this.remember({ kind: "register", challenge: options.challenge, ...at }), options };
  }

  async verifyRegistration(id: unknown, response: unknown, name: unknown): Promise<Omit<PasskeyConfig, "publicKey" | "counter">> {
    const p = this.take(id, "register");
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: p.challenge,
        expectedOrigin: p.origin,
        expectedRPID: p.rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      throw new PasskeyError(`패스키를 확인하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!v.verified || !v.registrationInfo) throw new PasskeyError("패스키를 확인하지 못했습니다");
    const { credential } = v.registrationInfo;
    const saved = this.config.addPasskey({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: typeof name === "string" && name.trim() ? name : "패스키",
      rpID: p.rpID,
    });
    const { publicKey: _k, counter: _c, ...rest } = saved;
    return rest;
  }

  async authenticationOptions(at: { origin: string; rpID: string }): Promise<{ id: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const keys = this.config.get().passkeys.filter((k) => k.rpID === at.rpID);
    if (keys.length === 0) throw new PasskeyError("이 주소로 등록한 패스키가 없습니다");
    const options = await generateAuthenticationOptions({
      rpID: at.rpID,
      allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports as AuthenticatorTransportFuture[] })),
      userVerification: "preferred",
    });
    return { id: this.remember({ kind: "login", challenge: options.challenge, ...at }), options };
  }

  /** 맞으면 true(서명 횟수·마지막 사용 시각을 고친다) */
  async verifyAuthentication(id: unknown, response: unknown): Promise<boolean> {
    const p = this.take(id, "login");
    const r = response as AuthenticationResponseJSON;
    const key = this.config.get().passkeys.find((k) => k.id === r?.id && k.rpID === p.rpID);
    if (!key) return false;
    try {
      const v = await verifyAuthenticationResponse({
        response: r,
        expectedChallenge: p.challenge,
        expectedOrigin: p.origin,
        expectedRPID: p.rpID,
        credential: { id: key.id, publicKey: Buffer.from(key.publicKey, "base64url"), counter: key.counter, transports: key.transports as AuthenticatorTransportFuture[] },
        requireUserVerification: false,
      });
      if (!v.verified) return false;
      this.config.touchPasskey(key.id, v.authenticationInfo.newCounter);
      return true;
    } catch {
      // 서명이 맞지 않거나 서명 횟수가 뒤로 갔다(복제 의심)
      return false;
    }
  }
}

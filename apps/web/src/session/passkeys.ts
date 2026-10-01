import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function getPasskeyAssertion(options: unknown) {
  return startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
}

export async function createPasskey(options: unknown) {
  return startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
}

export function isPasskeyCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

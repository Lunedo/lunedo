export class AuthError extends Error {
  override name = "AuthError";

  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("invalidCredentials", "The sign-in details are not valid");
  }
}

export class InvalidSecondFactorError extends AuthError {
  constructor() {
    super("invalidSecondFactor", "The second factor is not valid");
  }
}

export class LockedError extends AuthError {
  constructor(retryAfterSeconds: number) {
    super("locked", "Too many failed attempts; sign-in is locked temporarily", retryAfterSeconds);
  }
}

export class RateLimitedError extends AuthError {
  constructor(retryAfterSeconds: number) {
    super("rateLimited", "Too many attempts; try again later", retryAfterSeconds);
  }
}

export class ChallengeExpiredError extends AuthError {
  constructor() {
    super("challengeExpired", "The sign-in step has expired; start again");
  }
}

export class SetupIncompleteError extends AuthError {
  constructor() {
    super("setupIncomplete", "The instance is not set up yet");
  }
}

export class InvalidTokenError extends AuthError {
  constructor() {
    super("invalidToken", "The link is not valid or has expired");
  }
}

export class LastFactorError extends AuthError {
  constructor() {
    super(
      "lastSecondFactor",
      "The last second factor cannot be removed while two-factor authentication is required",
    );
  }
}

export class NoSecondFactorError extends AuthError {
  constructor() {
    super("noSecondFactor", "Set up a second factor first");
  }
}

export class SecondFactorExistsError extends AuthError {
  constructor() {
    super("secondFactorExists", "This second factor is already set up");
  }
}

export class SameEmailError extends AuthError {
  constructor() {
    super("sameEmail", "This is already the e-mail address of the account");
  }
}

export class PasswordSignInDisabledError extends AuthError {
  constructor() {
    super("passwordSignInDisabled", "Sign-in with a password is turned off for this account");
  }
}

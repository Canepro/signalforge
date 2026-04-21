export function isVercelDeployment(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.VERCEL === "1";
}

export function shouldEnableOperatorLiveRefresh(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  // Vercel is a review-only surface here, so disable interval refreshes there.
  return !isVercelDeployment(env);
}

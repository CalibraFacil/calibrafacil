const AUTH_ERROR_MESSAGES = new Map([
  [
    "invalid email or password",
    "Email ou senha inválidos. Verifique os dados e tente novamente.",
  ],
  ["invalid password", "Senha inválida. Verifique os dados e tente novamente."],
  ["invalid email", "Email inválido. Verifique o endereço informado."],
  ["invalid token", "Link inválido ou expirado. Solicite um novo link."],
  ["token expired", "Link expirado. Solicite um novo link."],
  ["expired_token", "Link expirado. Solicite um novo link."],
  ["invalid_otp", "Código inválido. Confira o email e tente novamente."],
  ["otp_expired", "Código expirado. Solicite um novo código."],
  [
    "too_many_attempts",
    "Muitas tentativas. Solicite um novo código e tente novamente.",
  ],
  [
    "new_user_signup_disabled",
    "Este email ainda não possui acesso provisionado.",
  ],
  ["passkey_not_found", "Passkey não encontrada para esta conta."],
  ["authentication_failed", "Não foi possível autenticar com a passkey."],
  ["registration_cancelled", "Criação da passkey cancelada."],
  ["auth_cancelled", "Entrada com passkey cancelada."],
  ["challenge_not_found", "A verificação da passkey expirou. Tente novamente."],
  ["session_required", "Entre novamente para cadastrar uma passkey."],
  ["email not verified", "Confirme seu email antes de continuar."],
  ["password too short", "A senha é muito curta. Use uma senha mais forte."],
  ["password too long", "A senha é muito longa. Use uma senha menor."],
  ["user already exists.", "Este email já está em uso."],
  ["user already exists. use another email.", "Este email já está em uso."],
  [
    "session expired. re-authenticate to perform this action.",
    "Sua sessão expirou. Entre novamente para continuar.",
  ],
  ["session is not fresh", "Entre novamente para confirmar esta ação."],
  [
    "credential account not found",
    "Esta conta ainda não possui uma senha definida. Use o link de acesso enviado por email.",
  ],
  [
    "user already has a password set",
    "Esta conta já possui uma senha definida.",
  ],
  ["organization already exists", "Esta organização já existe."],
  [
    "organization slug already taken",
    "Este slug de organização já está em uso.",
  ],
  ["organization not found", "Organização não encontrada."],
  [
    "user is already a member of this organization",
    "Este usuário já participa da organização.",
  ],
  ["member not found", "Membro não encontrado."],
  ["role not found", "Função não encontrada."],
  [
    "user is already invited to this organization",
    "Este usuário já foi convidado para a organização.",
  ],
  ["invitation not found", "Convite não encontrado ou expirado."],
  [
    "you are not the recipient of the invitation",
    "Este convite pertence a outro email.",
  ],
  [
    "email verification required before accepting or rejecting invitation",
    "Confirme seu email antes de aceitar ou recusar o convite.",
  ],
  [
    "you are not allowed to invite users to this organization",
    "Você não tem permissão para convidar usuários nesta organização.",
  ],
  [
    "you are not allowed to invite a user with this role",
    "Você não tem permissão para convidar usuários com esta função.",
  ],
  [
    "you are not allowed to update this organization",
    "Você não tem permissão para atualizar esta organização.",
  ],
  [
    "you are not allowed to delete this organization",
    "Você não tem permissão para excluir esta organização.",
  ],
  [
    "you are not allowed to delete this member",
    "Você não tem permissão para remover este membro.",
  ],
  [
    "you are not allowed to cancel this invitation",
    "Você não tem permissão para cancelar este convite.",
  ],
  [
    "organization membership limit reached",
    "O limite de membros da organização foi atingido.",
  ],
  [
    "invitation limit reached",
    "O limite de convites da organização foi atingido.",
  ],
]);

export function translateAuthErrorMessage(
  message: string | null | undefined,
  fallback: string,
) {
  const normalizedMessage = message?.trim();

  if (!normalizedMessage) {
    return fallback;
  }

  return (
    AUTH_ERROR_MESSAGES.get(normalizedMessage.toLowerCase()) ??
    normalizedMessage
  );
}

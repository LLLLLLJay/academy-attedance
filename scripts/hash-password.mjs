// 임시 스크립트 — academies.admin_password_hash에 넣을 bcrypt 해시 생성
// 실행: node scripts/hash-password.mjs
// 비밀번호 변경 시 아래 PASSWORD 상수만 수정 후 재실행

import bcrypt from 'bcryptjs';

const PASSWORD = '원하는비밀번호';
const SALT_ROUNDS = 12;

const hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
console.log(hash);

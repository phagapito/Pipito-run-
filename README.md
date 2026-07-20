# Pipito Run

App de corrida em grupo: cronômetro com GPS, treinos estruturados, plano de várias semanas,
comparação previsto x realizado e mural do grupo.

Dados pessoais (perfil, histórico de treinos, treinos que você montou) ficam salvos só no seu
celular (localStorage). Dados do grupo (mural e treinos enviados entre amigos) ficam no Firebase,
para todo mundo ver.

## 1. Criar o projeto no Firebase (grátis)

1. Acesse https://console.firebase.google.com e crie um projeto novo.
2. No menu lateral, vá em **Firestore Database** → **Criar banco de dados** → escolha
   **modo de teste** por enquanto (dá pra apertar as regras depois, veja a seção abaixo).
3. No menu lateral, vá em **Configurações do projeto** (ícone de engrenagem) → role até
   **Seus apps** → clique no ícone `</>` para registrar um app da Web.
4. Copie os valores gerados (`apiKey`, `authDomain`, `projectId`, etc.) — você vai usá-los
   no passo 3.

## 2. Rodar localmente (opcional, pra testar antes de publicar)

```bash
npm install
cp .env.example .env
# edite o .env e cole as chaves do Firebase
npm run dev
```

Abra o endereço que aparecer no terminal pelo celular (mesma rede Wi-Fi) ou publique
direto no GitHub Pages (próximo passo) — o GPS só funciona de verdade em HTTPS ou em
`localhost`.

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex: `pipito-run`) e suba este projeto para ele.
2. Em **Settings → Pages**, em "Build and deployment", escolha **GitHub Actions**
   como fonte (o workflow em `.github/workflows/deploy.yml` já está pronto).
3. Em **Settings → Secrets and variables → Actions**, adicione as chaves do Firebase
   como secrets, com esses nomes exatos:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
4. Abra `vite.config.js` e ajuste `base` para o nome exato do seu repositório
   (ex: `/pipito-run/`).
5. Dê push na branch `main` — o GitHub Actions builda e publica sozinho. O link fica
   em `Settings → Pages` depois que o deploy terminar (geralmente
   `https://SEU-USUARIO.github.io/pipito-run/`).

## 4. Convidar os amigos

Não tem cadastro nem convite — é só mandar o link do site. Cada um abre no celular,
digita um nome na primeira tela e já aparece no mural do grupo. Pra usar como um app
de verdade, cada um pode "Adicionar à tela de início" pelo navegador.

## Sobre as regras do Firestore

O modo de teste do Firestore libera leitura e escrita por 30 dias e depois bloqueia
tudo. Pra um grupo pequeno e de confiança, um exemplo simples de regra permanente
(ainda sem login, então continua aberta pra quem tiver o link — não use isso para
dados sensíveis):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /feedEntries/{doc} {
      allow read, write: if true;
    }
    match /assignedWorkouts/{doc} {
      allow read, write: if true;
    }
  }
}
```

Cole isso em **Firestore Database → Regras** no console do Firebase.

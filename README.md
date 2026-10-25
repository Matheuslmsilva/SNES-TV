# SNES TV

Emulador de Super Nintendo em WebAssembly com dois motores: **Snes9x 2005** (base do [CATSFC](https://github.com/ShadauxCat/CATSFC), leve, padrão) e **snes9x** atual via [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) feito para abrir no navegador da TV Samsung e jogar com o controle remoto ou um joystick USB/Bluetooth.

**Abrir:** https://matheuslmsilva.github.io/SNES-TV/

1. Abra o link no navegador "Internet" da TV.
2. Escolha **Adicionar pelo celular** e aponte a câmera do celular para o QR Code.
3. No celular, toque em **Escolher jogos** e selecione os arquivos `.sfc`, `.smc` ou `.zip`.
4. Os jogos ficam salvos na TV; da próxima vez é só abrir o link e escolher o jogo.

**Jogar online:** cartucho "Jogar online" — uma TV cria a partida e recebe um código, a outra entra com o código (mesmo arquivo de jogo nas duas). Só os botões trafegam (lockstep com conferência de memória).

**Celular como controle:** na TV escolha "Celular como controle" e leia o QR Code; o celular vira um controle de SNES (`controle.html`).

O envio usa conexão direta (WebRTC), com o servidor público gratuito do PeerJS só para combinar a conexão; os arquivos não ficam guardados em nenhum servidor.

As capas vêm da coleção pública [libretro-thumbnails](https://github.com/libretro-thumbnails/Nintendo_-_Super_Nintendo_Entertainment_System) (carregadas direto de lá; `covers.json` é só o índice de nomes).

Nenhum jogo vem incluído. Use apenas cópias que você tem o direito de usar.

Licenças: Snes9x 2005 (licença não comercial do snes9x, ver `lite/LICENSE-snes9x2005.txt`), fflate (MIT), PeerJS (MIT), qrcode-generator (MIT), snes9x (licença não comercial), EmulatorJS (GPL-3.0, ver `emulator/LICENSE-EmulatorJS.txt`).

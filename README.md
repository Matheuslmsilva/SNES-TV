# SNES TV

Emulador de Super Nintendo (snes9x em WebAssembly, via [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS)) feito para abrir no navegador da TV Samsung e jogar com o controle remoto ou um joystick USB/Bluetooth.

**Abrir:** https://matheuslmsilva.github.io/SNES-TV/

1. Abra o link no navegador "Internet" da TV.
2. Escolha **Adicionar pelo celular** e aponte a câmera do celular para o QR Code.
3. No celular, toque em **Escolher jogos** e selecione os arquivos `.sfc`, `.smc` ou `.zip`.
4. Os jogos ficam salvos na TV; da próxima vez é só abrir o link e escolher o jogo.

O envio usa conexão direta (WebRTC), com o servidor público gratuito do PeerJS só para combinar a conexão; os arquivos não ficam guardados em nenhum servidor.

Nenhum jogo vem incluído. Use apenas cópias que você tem o direito de usar.

Licenças: PeerJS (MIT), qrcode-generator (MIT), snes9x (licença não comercial), EmulatorJS (GPL-3.0, ver `emulator/LICENSE-EmulatorJS.txt`).

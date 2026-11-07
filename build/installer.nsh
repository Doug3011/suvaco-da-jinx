!macro customInstall
  ; força o Windows a invalidar o cache de ícones/associações dele depois
  ; de instalar/atualizar - sem isso, quem já tinha o app instalado (ex:
  ; de quando ainda era "Suvaco da Jinx") continuava vendo o ícone antigo
  ; na barra de tarefas/atalho mesmo com o .exe novo já tendo o ícone certo,
  ; porque o atalho/.lnk e o cache de thumbnail do Explorer não se atualizam
  ; sozinhos numa atualização in-place do NSIS.
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

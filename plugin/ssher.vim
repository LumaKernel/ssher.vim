augroup ssher-internal
  autocmd BufReadCmd ssher://* call ssher#internal#setup_buffer(bufnr())
  autocmd SessionLoadPost ssher://* call ssher#internal#setup_buffer(bufnr())
augroup END

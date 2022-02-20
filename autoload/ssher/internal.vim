function! ssher#internal#setup() abort
  augroup ssher-internal
    autocmd BufReadCmd ssher://* call denops#request_async('ssher', 'setup', [bufnr()], {->0}, {->0})
    autocmd SessionLoadPost ssher://* call denops#request_async('ssher', 'setup', [bufnr()], {->0}, {->0})
  augroup END
endfunction

" @param {Number} bufnr
function! ssher#internal#setup_buffer(bufnr) abort
  call ssher#internal#setbufline(a:bufnr, 1, 'processing...')
  set nomodified
  set nomodifiable
  let bufname = bufname(a:bufnr)
  if bufname =~# '/$'
    nnoremap <buffer> <CR> <CMD>call denops#request('ssher', 'onEnter', [bufnr()])<CR>
  else
    autocmd BufWriteCmd <buffer> call denops#request('ssher', 'onSave', [bufnr(), getline(1, '$')])
  endif
endfunction

" @param {Number} bufnr
" @param {Number} linenr
" @param {String | String[]} line
function! ssher#internal#setbufline(bufnr, linenr, line) abort
  let modifiable_save = getbufvar(a:bufnr, '&modifiable')
  let readonly_save = getbufvar(a:bufnr, '&readonly')
  let modified_save = getbufvar(a:bufnr, '&modified')

  call setbufvar(a:bufnr, '&modifiable', 1)
  call setbufvar(a:bufnr, '&readonly', 0)

  try
    call setbufline(a:bufnr, a:linenr, a:line)
  finally
    call setbufvar(a:bufnr, '&modifiable', modifiable_save)
    call setbufvar(a:bufnr, '&readonly', readonly_save)
    call setbufvar(a:bufnr, '&modified', modified_save)
  endtry
endfunction

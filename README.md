# 💻 ssher.vim

**WARNING**: Experimental and may change scheme if it is needed.

```vim
edit ssher://hostname/
edit ssher://user@hostname/
edit ssher://user@hostname:port/
```

Interacting in base64 for safety about special names.

## My scheme ideas (not implemented)

```vim
edit ssher://ssh:hostname/
edit ssher://ssh:user@hostname/
edit ssher://ssh:user@hostname:port/
edit ssher://ssh:user@hostname!i=%2f.ssh%2fid_rsa/
" Just edit local files
edit ssher://
```

## Local requisites

- [denops.vim](https://github.com/vim-denops/denops.vim)
- `ssh`

## Remote requisites

- Linux
  - `sh` (POSIX compatible)
  - `echo`
  - `cat`
  - `base64`
  - `printf`
  - `scp`
  - `stat`
  - `find`
  - `readlink`

## TODO

I'm just planning to implment what I just want (and I can).
PRs, or shareing ideas are welcome. Thank you!

- [x] open directory
- [x] select entry in directory
- [x] open file
- [x] edit file
- [x] save file (`scp`)
- [x] symlink to file
- [ ] symlink to dir
- [ ] Managing directory entries
  - [ ] add file/dir
  - [ ] delete file/dir
  - [ ] move file/dir
  - [ ] (trash?)
- [ ] keymap customization
- [ ] highlight file
  - now, filetype not detected
- [ ] support other than UTF-8 (`:help fileencoding`)
- [ ] support other than LF (`:help fileformat`)
- [ ] support no EOL mode (`:help endofline`)
- [ ] support binaries... (???)
- [ ] multi-hop symlinks (formatting)
- [ ] support ssh key path (`-i`)
- [ ] falling back `openssh` for encode/decode base64
- [ ] support bastion hosts
  - will change scheme rule
- [ ] documentation
- [ ] trick for huge directory (paging? no idea)
- [ ] integrate with [`fern.vim`](https://github.com/lambdalisue/fern.vim)

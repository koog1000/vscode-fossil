# Cloning with Fossil in VS Code

![Commands](/images/fossil-commands.png)

Cloning is possible from the fossil extension through the command palette
(Ctrl-Shift-P). Search for `Fossil: Clone`.

### Fossil Repository
You'll first be prompted to enter the repository URI. Enter the entire
URI, including the scheme (ex. `http://` , `file://` , `https://` , etc)

As an Example:
![FossilURI](/images/fossil-uri.png)

Hitting `Esc` will abort the cloning process

### Username
![fossil-user](/images/fossil-user.png)

You will be prompted for your repository authentication user name.
If you do not have a repository user name leave this blank.
Because a user name is not required, hitting `Esc` at this step does not
abort the cloning process.

### User Authentication
![fossil-auth](/images/fossil-auth.png)

If you entered a username you will be prompted to enter your user
authentication (password). Aborting here (by hitting `Esc`) does not
abort the cloning process but falls back to an anonymous clone (no
usernname and no authentication).

### Parent Directory
![fossil-root](/images/fossil-root.png)

Enter the root directory for the cloned repo. If VS Code is opened to a
folder the parent root directory will default to the currently opened
folder, otherwise it will be blank. Hitting `Esc` here will abort the
cloning process.

### Input Prompts
Various prompts may come up while cloning.
If these prompts are unclear then abort by hitting `Esc` and run your
`fossil clone` command from the built-in terminal (<code>Ctrl+`</code>).

Most notably this rather ugly prompt about SSL failure
can be read about on the
[Fossil SSL Certificate](https://fossil-scm.org/home/doc/trunk/www/ssl.wiki#certs)
wikipage:
![fossil-ssl-fail](/images/fossil-ssl-fail.png)

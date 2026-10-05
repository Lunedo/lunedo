FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

RUN apk add --no-cache openldap openldap-back-mdb openldap-clients \
  && install -d -o ldap -g ldap /run/openldap /var/lib/openldap/openldap-data

COPY slapd.conf /etc/openldap/slapd.conf
COPY seed.ldif /etc/openldap/seed.ldif

RUN slapadd -f /etc/openldap/slapd.conf -l /etc/openldap/seed.ldif \
  && chown -R ldap:ldap /var/lib/openldap/openldap-data

EXPOSE 389

HEALTHCHECK --interval=2s --timeout=3s --retries=30 \
  CMD ldapwhoami -x -H ldap://127.0.0.1 -D cn=pagehall,ou=service,dc=example,dc=org -w pagehall-ldap-service-password > /dev/null || exit 1

CMD ["slapd", "-d", "0", "-h", "ldap:///", "-f", "/etc/openldap/slapd.conf", "-u", "ldap", "-g", "ldap"]

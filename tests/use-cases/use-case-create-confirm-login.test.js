import fetch from 'cross-fetch';
import { version as uuidVersion } from 'uuid';
import { validate as uuidValidate } from 'uuid';
import orchestrator from 'tests/orchestrator.js';
import user from 'models/user.js';
import authentication from 'models/authentication';
import activation from 'models/activation.js';
import session from 'models/session.js';

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.dropAllTables();
  await orchestrator.runPendingMigrations();
  await orchestrator.deleteAllEmails();
});

describe('Use case: From Create Account to Use Session (all successfully)', () => {
  let postUserResponseBody;
  let activationUrl;
  let postSessionResponseBody;
  let parsedCookies;

  test('Create account (successfully)', async () => {
    const postUserResponse = await fetch(`${orchestrator.webserverUrl}/api/v1/users`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'RegularRegistrationFlow',
        email: 'RegularRegistrationFlow@gmail.com',
        password: 'RegularRegistrationFlowPassword',
      }),
    });

    postUserResponseBody = await postUserResponse.json();

    expect(postUserResponse.status).toEqual(201);
    expect(uuidVersion(postUserResponseBody.id)).toEqual(4);
    expect(uuidValidate(postUserResponseBody.id)).toEqual(true);
    expect(postUserResponseBody.username).toEqual('RegularRegistrationFlow');
    expect(postUserResponseBody.email).toEqual('regularregistrationflow@gmail.com');
    expect(postUserResponseBody.features).toEqual(['read:activation_token']);
    expect(Date.parse(postUserResponseBody.created_at)).not.toEqual(NaN);
    expect(Date.parse(postUserResponseBody.updated_at)).not.toEqual(NaN);
    expect(postUserResponseBody).not.toHaveProperty('password');

    const createdUserInDatabase = await user.findOneByUsername('RegularRegistrationFlow');
    const passwordsMatch = await authentication.comparePasswords(
      'RegularRegistrationFlowPassword',
      createdUserInDatabase.password
    );

    expect(passwordsMatch).toBe(true);
  });

  test('Receive email (successfully)', async () => {
    const activationEmail = await orchestrator.getLastEmail();

    const tokenObject = await activation.findOneTokenByUserId(postUserResponseBody.id);
    activationUrl = activation.getActivationUrl(tokenObject.id);

    expect(activationEmail.sender).toEqual('<contato@tabnews.com.br>');
    expect(activationEmail.recipients).toEqual(['<regularregistrationflow@gmail.com>']);
    expect(activationEmail.subject).toEqual('Ative seu cadastro no TabNews');
    expect(activationEmail.text.includes(postUserResponseBody.username)).toBe(true);
    expect(activationEmail.text.includes(activationUrl)).toBe(true);
  });

  test('Activate (successfully)', async () => {
    const activationLinkResponse = await fetch(activationUrl);
    const activationLinkResponseBody = await activationLinkResponse.json();

    expect(activationLinkResponse.status).toEqual(200);
    expect(uuidVersion(activationLinkResponseBody.id)).toEqual(4);
    expect(uuidValidate(activationLinkResponseBody.id)).toEqual(true);
    expect(activationLinkResponseBody.id).toEqual(postUserResponseBody.id);
    expect(activationLinkResponseBody.username).toEqual(postUserResponseBody.username);
    expect(activationLinkResponseBody.features).toEqual([
      'create:session',
      'read:session',
      'create:post',
      'create:comment',
    ]);
    expect(Date.parse(activationLinkResponseBody.created_at)).not.toEqual(NaN);
    expect(Date.parse(activationLinkResponseBody.updated_at)).not.toEqual(NaN);
    expect(activationLinkResponseBody).not.toHaveProperty('password');
    expect(activationLinkResponseBody).not.toHaveProperty('email');
  });

  test('Login (successfully)', async () => {
    const postSessionResponse = await fetch(`${orchestrator.webserverUrl}/api/v1/sessions`, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'RegularRegistrationFlow',
        password: 'RegularRegistrationFlowPassword',
      }),
    });

    postSessionResponseBody = await postSessionResponse.json();

    expect(postSessionResponse.status).toEqual(201);
    expect(postSessionResponseBody.id.length).toEqual(96);
    expect(Date.parse(postSessionResponseBody.expires_at)).not.toEqual(NaN);
    expect(Date.parse(postSessionResponseBody.created_at)).not.toEqual(NaN);
    expect(Date.parse(postSessionResponseBody.updated_at)).not.toEqual(NaN);

    const sessionObjectInDatabase = await session.findOneById(postSessionResponseBody.id);
    expect(sessionObjectInDatabase.user_id).toEqual(postUserResponseBody.id);

    parsedCookies = authentication.parseSetCookies(postSessionResponse);
    expect(parsedCookies.session_id.name).toEqual('session_id');
    expect(parsedCookies.session_id.value).toEqual(postSessionResponseBody.id);
    expect(parsedCookies.session_id.maxAge).toEqual(60 * 60 * 24 * 30);
    expect(parsedCookies.session_id.path).toEqual('/');
    expect(parsedCookies.session_id.httpOnly).toEqual(true);
  });

  test('Use session (successfully)', async () => {
    const getSessionResponse = await fetch(`${orchestrator.webserverUrl}/api/v1/sessions`, {
      method: 'get',
      headers: {
        cookie: `session_id=${parsedCookies.session_id.value}`,
      },
    });

    const getSessionResponseBody = await getSessionResponse.json();

    expect(getSessionResponse.status).toEqual(200);
    expect(getSessionResponseBody.id).toEqual(postSessionResponseBody.id);
    expect(getSessionResponseBody.id.length).toEqual(96);
    expect(Date.parse(getSessionResponseBody.expires_at)).not.toEqual(NaN);
    expect(Date.parse(getSessionResponseBody.created_at)).not.toEqual(NaN);
    expect(Date.parse(getSessionResponseBody.updated_at)).not.toEqual(NaN);
    expect(getSessionResponseBody.expires_at > postSessionResponseBody.expires_at).toBe(true);
    expect(getSessionResponseBody.created_at === postSessionResponseBody.created_at).toBe(true);
    expect(getSessionResponseBody.updated_at > postSessionResponseBody.updated_at).toBe(true);
  });
});

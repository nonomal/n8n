import { Container } from '@n8n/di';

import type { User } from '@/databases/entities/user';
import { FolderRepository } from '@/databases/repositories/folder.repository';
import { ProjectRepository } from '@/databases/repositories/project.repository';
import { createFolder } from '@test-integration/db/folders';
import { createTag } from '@test-integration/db/tags';

import { createTeamProject, linkUserToProject } from '../shared/db/projects';
import { createOwner, createMember } from '../shared/db/users';
import * as testDb from '../shared/test-db';
import type { SuperAgentTest } from '../shared/types';
import * as utils from '../shared/utils/';

let owner: User;
let member: User;
let authOwnerAgent: SuperAgentTest;
let authMemberAgent: SuperAgentTest;

const testServer = utils.setupTestServer({
	endpointGroups: ['folder'],
});

let projectRepository: ProjectRepository;
let folderRepository: FolderRepository;

beforeEach(async () => {
	await testDb.truncate(['Folder', 'SharedWorkflow', 'Tag', 'Project', 'ProjectRelation']);

	projectRepository = Container.get(ProjectRepository);
	folderRepository = Container.get(FolderRepository);

	owner = await createOwner();
	member = await createMember();
	authOwnerAgent = testServer.authAgentFor(owner);
	authMemberAgent = testServer.authAgentFor(member);
});

describe('POST /projects/:projectId/folders', () => {
	test('should not create folder when project does not exist', async () => {
		const payload = {
			name: 'Test Folder',
		};

		await authOwnerAgent.post('/projects/non-existing-id/folders').send(payload).expect(403);
	});

	test('should not create folder when name is empty', async () => {
		const project = await createTeamProject(undefined, owner);
		const payload = {
			name: '',
		};

		await authOwnerAgent.post(`/projects/${project.id}/folders`).send(payload).expect(400);
	});

	test('should not create folder if user has project:viewer role in team project', async () => {
		const project = await createTeamProject(undefined, owner);
		await linkUserToProject(member, project, 'project:viewer');

		const payload = {
			name: 'Test Folder',
		};

		await authMemberAgent.post(`/projects/${project.id}/folders`).send(payload).expect(403);

		const foldersInDb = await folderRepository.find();
		expect(foldersInDb).toHaveLength(0);
	});

	test("should not allow creating folder in another user's personal project", async () => {
		const ownerPersonalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const payload = {
			name: 'Test Folder',
		};

		await authMemberAgent
			.post(`/projects/${ownerPersonalProject.id}/folders`)
			.send(payload)
			.expect(403);
	});

	test('should create folder if user has project:editor role in team project', async () => {
		const project = await createTeamProject(undefined, owner);
		await linkUserToProject(member, project, 'project:editor');

		const payload = {
			name: 'Test Folder',
		};

		await authMemberAgent.post(`/projects/${project.id}/folders`).send(payload).expect(200);

		const foldersInDb = await folderRepository.find();
		expect(foldersInDb).toHaveLength(1);
	});

	test('should create folder if user has project:admin role in team project', async () => {
		const project = await createTeamProject(undefined, owner);

		const payload = {
			name: 'Test Folder',
		};

		await authOwnerAgent.post(`/projects/${project.id}/folders`).send(payload).expect(200);

		const foldersInDb = await folderRepository.find();
		expect(foldersInDb).toHaveLength(1);
	});

	test('should not allow creating folder with parent that exists in another project', async () => {
		const ownerPersonalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const memberTeamProject = await createTeamProject('test project', member);
		const ownerRootFolderInPersonalProject = await createFolder(ownerPersonalProject);
		await createFolder(memberTeamProject);

		const payload = {
			name: 'Test Folder',
			parentFolderId: ownerRootFolderInPersonalProject.id,
		};

		await authMemberAgent
			.post(`/projects/${memberTeamProject.id}/folders`)
			.send(payload)
			.expect(404);
	});

	test('should create folder in root of specified project', async () => {
		const project = await createTeamProject('test', owner);
		const payload = {
			name: 'Test Folder',
		};

		const response = await authOwnerAgent.post(`/projects/${project.id}/folders`).send(payload);

		expect(response.body.data).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				name: payload.name,
				parentFolder: null,
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
			}),
		);

		const folderInDb = await folderRepository.findOneBy({ id: response.body.id });
		expect(folderInDb).toBeDefined();
		expect(folderInDb?.name).toBe(payload.name);
	});

	test('should create folder in specified project within another folder', async () => {
		const project = await createTeamProject('test', owner);
		const folder = await createFolder(project);

		const payload = {
			name: 'Test Folder',
			parentFolderId: folder.id,
		};

		const response = await authOwnerAgent.post(`/projects/${project.id}/folders`).send(payload);

		expect(response.body.data).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				name: payload.name,
				parentFolder: expect.objectContaining({
					id: folder.id,
					name: folder.name,
					createdAt: expect.any(String),
					updatedAt: expect.any(String),
				}),
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
			}),
		);

		const folderInDb = await folderRepository.findOneBy({ id: response.body.data.id });

		expect(folderInDb).toBeDefined();
		expect(folderInDb?.name).toBe(payload.name);
	});

	test('should create folder in personal project', async () => {
		const personalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const payload = {
			name: 'Personal Folder',
		};

		const response = await authOwnerAgent
			.post(`/projects/${personalProject.id}/folders`)
			.send(payload)
			.expect(200);

		expect(response.body.data).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				name: payload.name,
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
			}),
		);

		const folderInDb = await folderRepository.findOneBy({ id: response.body.id });
		expect(folderInDb).toBeDefined();
		expect(folderInDb?.name).toBe(payload.name);
	});
});

describe('GET /projects/:projectId/folders/:folderId/tree', () => {
	test('should not get folder tree when project does not exist', async () => {
		await authOwnerAgent.get('/projects/non-existing-id/folders/some-folder-id/tree').expect(403);
	});

	test('should not get folder tree when folder does not exist', async () => {
		const project = await createTeamProject('test project', owner);

		await authOwnerAgent
			.get(`/projects/${project.id}/folders/non-existing-folder/tree`)
			.expect(404);
	});

	test('should not get folder tree if user has no access to project', async () => {
		const project = await createTeamProject('test project', owner);
		const folder = await createFolder(project);

		await authMemberAgent.get(`/projects/${project.id}/folders/${folder.id}/tree`).expect(403);
	});

	test("should not allow getting folder tree from another user's personal project", async () => {
		const ownerPersonalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const folder = await createFolder(ownerPersonalProject);

		await authMemberAgent
			.get(`/projects/${ownerPersonalProject.id}/folders/${folder.id}/tree`)
			.expect(403);
	});

	test('should get nested folder structure', async () => {
		const project = await createTeamProject('test', owner);
		const rootFolder = await createFolder(project, { name: 'Root' });

		const childFolder1 = await createFolder(project, {
			name: 'Child 1',
			parentFolder: rootFolder,
		});

		await createFolder(project, {
			name: 'Child 2',
			parentFolder: rootFolder,
		});

		const grandchildFolder = await createFolder(project, {
			name: 'Grandchild',
			parentFolder: childFolder1,
		});

		const response = await authOwnerAgent
			.get(`/projects/${project.id}/folders/${grandchildFolder.id}/tree`)
			.expect(200);

		expect(response.body.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: rootFolder.id,
					name: 'Root',
					children: expect.arrayContaining([
						expect.objectContaining({
							id: childFolder1.id,
							name: 'Child 1',
							children: expect.arrayContaining([
								expect.objectContaining({
									id: grandchildFolder.id,
									name: 'Grandchild',
									children: [],
								}),
							]),
						}),
					]),
				}),
			]),
		);
	});
});

describe('PATCH /projects/:projectId/folders/:folderId', () => {
	test('should not update folder when project does not exist', async () => {
		const payload = {
			name: 'Updated Folder Name',
		};

		await authOwnerAgent
			.patch('/projects/non-existing-id/folders/some-folder-id')
			.send(payload)
			.expect(403);
	});

	test('should not update folder when folder does not exist', async () => {
		const project = await createTeamProject('test project', owner);

		const payload = {
			name: 'Updated Folder Name',
		};

		await authOwnerAgent
			.patch(`/projects/${project.id}/folders/non-existing-folder`)
			.send(payload)
			.expect(404);
	});

	test('should not update folder when name is empty', async () => {
		const project = await createTeamProject(undefined, owner);
		const folder = await createFolder(project, { name: 'Original Name' });

		const payload = {
			name: '',
		};

		await authOwnerAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(400);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Original Name');
	});

	test('should not update folder if user has project:viewer role in team project', async () => {
		const project = await createTeamProject(undefined, owner);
		const folder = await createFolder(project, { name: 'Original Name' });
		await linkUserToProject(member, project, 'project:viewer');

		const payload = {
			name: 'Updated Folder Name',
		};

		await authMemberAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(403);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Original Name');
	});

	test("should not allow updating folder in another user's personal project", async () => {
		const ownerPersonalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const folder = await createFolder(ownerPersonalProject, { name: 'Original Name' });

		const payload = {
			name: 'Updated Folder Name',
		};

		await authMemberAgent
			.patch(`/projects/${ownerPersonalProject.id}/folders/${folder.id}`)
			.send(payload)
			.expect(403);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Original Name');
	});

	test('should update folder if user has project:editor role in team project', async () => {
		const project = await createTeamProject(undefined, owner);
		const folder = await createFolder(project, { name: 'Original Name' });
		await linkUserToProject(member, project, 'project:editor');

		const payload = {
			name: 'Updated Folder Name',
		};

		await authMemberAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(200);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Updated Folder Name');
	});

	test('should update folder if user has project:admin role in team project', async () => {
		const project = await createTeamProject(undefined, owner);
		const folder = await createFolder(project, { name: 'Original Name' });

		const payload = {
			name: 'Updated Folder Name',
		};

		await authOwnerAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(200);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Updated Folder Name');
	});

	test('should update folder in personal project', async () => {
		const personalProject = await projectRepository.getPersonalProjectForUserOrFail(owner.id);
		const folder = await createFolder(personalProject, { name: 'Original Name' });

		const payload = {
			name: 'Updated Folder Name',
		};

		await authOwnerAgent
			.patch(`/projects/${personalProject.id}/folders/${folder.id}`)
			.send(payload)
			.expect(200);

		const folderInDb = await folderRepository.findOneBy({ id: folder.id });
		expect(folderInDb?.name).toBe('Updated Folder Name');
	});

	test('should update folder tags', async () => {
		const project = await createTeamProject('test project', owner);
		const folder = await createFolder(project, { name: 'Test Folder' });
		const tag1 = await createTag({ name: 'Tag 1' });
		const tag2 = await createTag({ name: 'Tag 2' });

		const payload = {
			tagIds: [tag1.id, tag2.id],
		};

		await authOwnerAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(200);

		const folderWithTags = await folderRepository.findOne({
			where: { id: folder.id },
			relations: ['tags'],
		});

		expect(folderWithTags?.tags).toHaveLength(2);
		expect(folderWithTags?.tags.map((t) => t.id).sort()).toEqual([tag1.id, tag2.id].sort());
	});

	test('should replace existing folder tags with new ones', async () => {
		const project = await createTeamProject(undefined, owner);
		const tag1 = await createTag({ name: 'Tag 1' });
		const tag2 = await createTag({ name: 'Tag 2' });
		const tag3 = await createTag({ name: 'Tag 3' });

		const folder = await createFolder(project, {
			name: 'Test Folder',
			tags: [tag1, tag2],
		});

		const payload = {
			tagIds: [tag3.id],
		};

		await authOwnerAgent
			.patch(`/projects/${project.id}/folders/${folder.id}`)
			.send(payload)
			.expect(200);

		const folderWithTags = await folderRepository.findOne({
			where: { id: folder.id },
			relations: ['tags'],
		});

		expect(folderWithTags?.tags).toHaveLength(1);
		expect(folderWithTags?.tags[0].id).toBe(tag3.id);
	});
});
